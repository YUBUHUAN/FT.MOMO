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
        // Settings (including the login token) must survive replacing the app
        // folder when a new version is installed.
        string stable = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MomoPet");
        try
        {
            Directory.CreateDirectory(stable);
            string probe = Path.Combine(stable, ".write-test");
            File.WriteAllText(probe, "1");
            File.Delete(probe);
            return stable;
        }
        catch
        {
            string roaming = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MomoPet");
            try
            {
                Directory.CreateDirectory(roaming);
                return roaming;
            }
            catch
            {
                return AppContext.BaseDirectory;
            }
        }
    }

    private static void MigrateLegacySettings()
    {
        if (File.Exists(FilePath)) return;
        string baseSettings = Path.Combine(AppContext.BaseDirectory, "desktop-settings.json");
        string roamingSettings = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MomoPet", "desktop-settings.json");
        foreach (string candidate in new[] { baseSettings, roamingSettings })
        {
            try
            {
                if (!File.Exists(candidate)) continue;
                if (string.Equals(Path.GetFullPath(candidate), Path.GetFullPath(FilePath), StringComparison.OrdinalIgnoreCase))
                    continue;
                Directory.CreateDirectory(Dir);
                File.Copy(candidate, FilePath, overwrite: false);
                return;
            }
            catch { }
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public static AppSettings Load()
    {
        MigrateLegacySettings();
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
