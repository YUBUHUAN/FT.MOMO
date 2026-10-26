using System.IO;
using System.Text.Json;
using Microsoft.Win32;

namespace MomoPet;

public sealed class AppSettings
{
    public bool Sound { get; set; } = true;
    public bool AlwaysOnTop { get; set; } = true;
    public bool AutoLaunch { get; set; }
    public string Token { get; set; } = "";
    public string Username { get; set; } = "";
    public double? Left { get; set; }
    public double? Top { get; set; }
}

public static class SettingsStore
{
    private static readonly string Dir = ResolveDir();
    private static readonly string FilePath = Path.Combine(Dir, "desktop-settings.json");

    private static string ResolveDir()
    {
        string baseDir = AppContext.BaseDirectory;
        try
        {
            string probe = Path.Combine(baseDir, ".write-test");
            File.WriteAllText(probe, "1");
            File.Delete(probe);
            return baseDir;
        }
        catch
        {
            string fallback = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MomoPet");
            Directory.CreateDirectory(fallback);
            return fallback;
        }
    }
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                var loaded = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath));
                if (loaded != null) return loaded;
            }
        }
        catch { }
        return new AppSettings();
    }

    public static void Save(AppSettings settings)
    {
        try
        {
            Directory.CreateDirectory(Dir);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(settings, JsonOptions));
        }
        catch { }
    }

    public static void ApplyStartup(bool enabled)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run", writable: true);
            if (key == null) return;
            if (enabled)
            {
                string exe = Environment.ProcessPath ?? "";
                string baseDir = AppContext.BaseDirectory;
                string portableLauncher = Path.Combine(baseDir, "启动墨墨.cmd");
                // A portable copy carries a private .NET runtime: the launcher
                // must set DOTNET_ROOT before the apphost starts.
                string command = File.Exists(portableLauncher) && Directory.Exists(Path.Combine(baseDir, "dotnet"))
                    ? "cmd.exe /c \"\"" + portableLauncher + "\"\""
                    : "\"" + exe + "\"";
                if (!string.IsNullOrWhiteSpace(command)) key.SetValue("MomoPet", command);
            }
            else
            {
                key.DeleteValue("MomoPet", throwOnMissingValue: false);
            }
        }
        catch { }
    }
}
