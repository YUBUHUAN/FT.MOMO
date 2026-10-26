using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.Json.Nodes;

namespace MomoPet;

/// <summary>Starts the bundled zero-dependency Node sync server and discovers its LAN URLs.</summary>
public sealed class ServerHost : IAsyncDisposable
{
    public string BaseUrl { get; private init; } = "";
    public IReadOnlyList<(string Name, string Url)> Urls { get; private init; } = Array.Empty<(string, string)>();
    public string DataDir { get; private init; } = "";
    public int Port { get; private init; }

    private Process? _process;
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(4) };

    public static async Task<ServerHost> StartAsync()
    {
        string baseDir = AppContext.BaseDirectory;
        string node = Path.Combine(baseDir, "node", "node.exe");
        string serverJs = Path.Combine(baseDir, "server", "server.js");
        if (!File.Exists(node))
        {
            string? envNode = Environment.GetEnvironmentVariable("MOMO_NODE");
            if (!string.IsNullOrEmpty(envNode) && File.Exists(envNode)) node = envNode;
        }
        if (!File.Exists(node)) throw new FileNotFoundException("找不到内置的 node.exe", node);
        if (!File.Exists(serverJs)) throw new FileNotFoundException("找不到同步服务端文件", serverJs);

        // Data lives in LocalAppData so replacing/updating the app folder never
        // wipes accounts or the pet's history. Older portable data is migrated
        // once, on the first launch after this change.
        string? envData = Environment.GetEnvironmentVariable("MOMO_DATA");
        string dataDir;
        if (!string.IsNullOrWhiteSpace(envData))
        {
            dataDir = envData;
        }
        else
        {
            dataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "MomoPet", "data");
            string roaming = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MomoPet", "data");
            try
            {
                Directory.CreateDirectory(dataDir);
                MigrateLegacyData(Path.Combine(baseDir, "data"), dataDir);
                MigrateLegacyData(roaming, dataDir);
            }
            catch
            {
                // Last resort: keep working next to the executable.
                dataDir = Path.Combine(baseDir, "data");
            }
        }
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(Path.Combine(dataDir, "states"));
        if (string.IsNullOrWhiteSpace(envData))
        {
            // Some locked-down environments (and the DSH debug sandbox) deny
            // Node writes outside the workspace even though the ACL is fine.
            // Probe with the same bundled Node, then fall back to the app folder
            // instead of leaving the whole app unable to start.
            string selected = dataDir;
            if (!CanNodeWrite(node, selected))
            {
                string fallback = Path.Combine(baseDir, "data");
                try
                {
                    Directory.CreateDirectory(fallback);
                    Directory.CreateDirectory(Path.Combine(fallback, "states"));
                    if (!HasUsefulData(fallback) && HasUsefulData(selected))
                        CopyDirectory(selected, fallback);
                    dataDir = fallback;
                    try
                    {
                        File.AppendAllText(Path.Combine(fallback, "fallback.log"),
                            $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] Node cannot write {selected}; using {fallback}{Environment.NewLine}");
                    }
                    catch { }
                }
                catch { }
            }
        }
        string logPath = Path.Combine(dataDir, "server.log");

        int port = FindPort(8787);
        var psi = new ProcessStartInfo
        {
            FileName = node,
            Arguments = $"\"{serverJs}\"",
            WorkingDirectory = baseDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        psi.Environment["MOMO_PORT"] = port.ToString();
        psi.Environment["MOMO_DATA"] = dataDir;
        psi.Environment["MOMO_WEB"] = Path.Combine(baseDir, "web");
        psi.Environment["MOMO_SHARED"] = Path.Combine(baseDir, "shared");
        psi.Environment.Remove("ELECTRON_RUN_AS_NODE");

        var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        proc.OutputDataReceived += (_, e) => { if (e.Data != null) AppendLog(logPath, e.Data); };
        proc.ErrorDataReceived += (_, e) => { if (e.Data != null) AppendLog(logPath, "ERR " + e.Data); };
        proc.Start();
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();

        string baseUrl = $"http://127.0.0.1:{port}";
        try
        {
            await WaitHealthyAsync(baseUrl);
            JsonNode boot = await GetJsonAsync(baseUrl + "/api/bootstrap");
            var urls = new List<(string, string)>();
            if (boot["urls"] is JsonArray arr)
            {
                foreach (JsonNode? item in arr)
                {
                    if (item == null) continue;
                    urls.Add((item["name"]?.GetValue<string>() ?? "局域网", item["url"]?.GetValue<string>() ?? ""));
                }
            }
            return new ServerHost
            {
                _process = proc,
                BaseUrl = baseUrl,
                Port = port,
                Urls = urls,
                DataDir = dataDir
            };
        }
        catch
        {
            try { proc.Kill(true); } catch { }
            throw;
        }
    }

    private static bool CanNodeWrite(string node, string dir)
    {
        string probe = Path.Combine(dir, ".node-probe-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(probe);
            var psi = new ProcessStartInfo
            {
                FileName = node,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            psi.ArgumentList.Add("-e");
            psi.ArgumentList.Add("const fs=require('fs'); const p=process.argv[1]; fs.writeFileSync(p+'/ok','1');");
            psi.ArgumentList.Add(probe);
            using var proc = Process.Start(psi);
            if (proc == null) return false;
            if (!proc.WaitForExit(6000))
            {
                try { proc.Kill(true); } catch { }
                return false;
            }
            return proc.ExitCode == 0 && File.Exists(Path.Combine(probe, "ok"));
        }
        catch
        {
            return false;
        }
        finally
        {
            try { Directory.Delete(probe, recursive: true); } catch { }
        }
    }

    private static void MigrateLegacyData(string source, string destination)
    {
        try
        {
            if (!Directory.Exists(source)) return;
            if (string.Equals(Path.GetFullPath(source), Path.GetFullPath(destination), StringComparison.OrdinalIgnoreCase)) return;
            if (!HasUsefulData(source) || HasUsefulData(destination)) return;
            Directory.CreateDirectory(destination);
            CopyDirectory(source, destination);
            try
            {
                File.AppendAllText(Path.Combine(destination, "migration.log"),
                    $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] migrated data from {source}{Environment.NewLine}");
            }
            catch { }
        }
        catch { }
    }

    private static bool HasUsefulData(string dir)
    {
        try
        {
            string accounts = Path.Combine(dir, "accounts.json");
            if (File.Exists(accounts))
            {
                JsonNode? root = JsonNode.Parse(File.ReadAllText(accounts));
                if (root?["accounts"] is JsonArray arr && arr.Count > 0) return true;
            }
            string states = Path.Combine(dir, "states");
            if (Directory.Exists(states) && Directory.EnumerateFiles(states, "*.json").Any()) return true;
            string rooms = Path.Combine(dir, "rooms");
            if (Directory.Exists(rooms) && Directory.EnumerateFiles(rooms, "*.json").Any()) return true;
        }
        catch { }
        return false;
    }

    private static void CopyDirectory(string source, string destination)
    {
        foreach (string file in Directory.EnumerateFiles(source))
        {
            string target = Path.Combine(destination, Path.GetFileName(file));
            File.Copy(file, target, overwrite: true);
        }
        foreach (string dir in Directory.EnumerateDirectories(source))
        {
            string target = Path.Combine(destination, Path.GetFileName(dir));
            Directory.CreateDirectory(target);
            CopyDirectory(dir, target);
        }
    }

    private static int FindPort(int start)
    {
        for (int p = start; p < start + 25; p++)
        {
            try
            {
                var listener = new TcpListener(IPAddress.Any, p);
                listener.Start();
                listener.Stop();
                return p;
            }
            catch (SocketException) { }
        }
        throw new IOException("没有可用的本地端口（8787-8811）");
    }

    private static async Task WaitHealthyAsync(string baseUrl)
    {
        for (int i = 0; i < 80; i++)
        {
            try
            {
                using var res = await Http.GetAsync(baseUrl + "/api/health");
                if (res.IsSuccessStatusCode) return;
            }
            catch { }
            await Task.Delay(180);
        }
        throw new TimeoutException("同步服务端启动超时");
    }

    private static async Task<JsonNode> GetJsonAsync(string url)
    {
        string json = await Http.GetStringAsync(url);
        return JsonNode.Parse(json) ?? throw new InvalidDataException("服务端返回为空");
    }

    private static void AppendLog(string file, string line)
    {
        try
        {
            if (line.Length > 4000) line = line[..4000];
            File.AppendAllText(file, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {line}{Environment.NewLine}", Encoding.UTF8);
        }
        catch { }
    }

    public ValueTask DisposeAsync()
    {
        try
        {
            if (_process is { HasExited: false })
            {
                _process.Kill(entireProcessTree: true);
                _process.WaitForExit(1500);
            }
        }
        catch { }
        _process?.Dispose();
        return ValueTask.CompletedTask;
    }
}
