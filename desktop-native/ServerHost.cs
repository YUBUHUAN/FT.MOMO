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

        // Portable by default: keep the room next to the executable so moving the
        // folder moves her data too. Fall back to AppData if this folder is read-only.
        string appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MomoPet");
        string dataDir = Path.Combine(baseDir, "data");
        string? envData = Environment.GetEnvironmentVariable("MOMO_DATA");
        if (!string.IsNullOrWhiteSpace(envData))
        {
            dataDir = envData;
        }
        else
        {
            try
            {
                Directory.CreateDirectory(dataDir);
                string probe = Path.Combine(dataDir, ".write-test");
                File.WriteAllText(probe, "1");
                File.Delete(probe);
            }
            catch
            {
                dataDir = Path.Combine(appData, "data");
            }
        }
        Directory.CreateDirectory(dataDir);
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
