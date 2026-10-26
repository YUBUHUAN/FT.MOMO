using System.IO;
using System.Threading;
using System.Windows;
using MessageBox = System.Windows.MessageBox;

namespace MomoPet;

public partial class App : System.Windows.Application
{
    private Mutex? _mutex;
    private ServerHost? _server;

    public static bool SmokeMode { get; private set; }

    private static readonly string StartupLog = Path.Combine(AppContext.BaseDirectory, "startup.log");

    private static void StartLog(string message)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(StartupLog)!);
            File.AppendAllText(StartupLog, $"[{DateTime.Now:HH:mm:ss.fff}] {message}{Environment.NewLine}");
        }
        catch { }
    }

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(StartupLog)!);
            File.WriteAllText(StartupLog, $"[{DateTime.Now:HH:mm:ss.fff}] boot args={string.Join(" ", e.Args)} base={AppContext.BaseDirectory} DOTNET_ROOT={Environment.GetEnvironmentVariable("DOTNET_ROOT")} MOMO_SMOKE={Environment.GetEnvironmentVariable("MOMO_SMOKE")}{Environment.NewLine}");
        }
        catch { }
        SmokeMode = e.Args.Contains("--smoke") || Environment.GetEnvironmentVariable("MOMO_SMOKE") == "1";
        DispatcherUnhandledException += (_, args) =>
        {
            StartLog("UI FAILED " + args.Exception);
        };
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            StartLog("DOMAIN FAILED " + args.ExceptionObject);
        };

        _mutex = new Mutex(true, "MomoPet.Desktop.SingleInstance", out bool created);
        if (!created)
        {
            Shutdown();
            return;
        }

        try
        {
            StartLog("server starting");
            _server = await ServerHost.StartAsync();
            StartLog("server ready " + _server.BaseUrl);
            var api = new ApiClient(_server.BaseUrl);
            await api.LoadContentAsync();
            StartLog("content loaded");

            var settings = SettingsStore.Load();
            bool hadSession = false;
            if (!string.IsNullOrWhiteSpace(settings.Token))
            {
                api.Token = settings.Token;
                hadSession = await api.TryMeAsync();
                if (hadSession)
                {
                    await api.GetStateAsync();
                    StartLog("session restored " + api.AccountName);
                }
            }

            if (!hadSession)
            {
                if (SmokeMode)
                {
                    string user = Environment.GetEnvironmentVariable("MOMO_SMOKE_USER") ?? "smoke";
                    string pass = Environment.GetEnvironmentVariable("MOMO_SMOKE_PASS") ?? "smokepass123";
                    try { await api.LoginAsync(user, pass); }
                    catch (ApiException) { await api.RegisterAsync(user, pass); }
                    SettingsStore.Save(settings);
                }
                else
                {
                    var auth = new AuthWindow(api, _server);
                    if (auth.ShowDialog() != true)
                    {
                        Shutdown();
                        return;
                    }
                    settings.Token = api.Token;
                    settings.Username = api.AccountName;
                    SettingsStore.Save(settings);
                    StartLog("account " + api.AccountName);
                }
            }
            if (api.State == null) await api.GetStateAsync();
            StartLog("state loaded");

            var window = new MainWindow(_server, api, SmokeMode);
            MainWindow = window;
            bool smokeVisible = SmokeMode && Environment.GetEnvironmentVariable("MOMO_SMOKE_SHOW") == "1";
            if (SmokeMode && !smokeVisible)
            {
                window.Left = -3200;
                window.Top = -3200;
                window.ShowActivated = false;
            }
            else
            {
                window.Left = settings.Left ?? SystemParameters.WorkArea.Right - 400;
                window.Top = settings.Top ?? SystemParameters.WorkArea.Bottom - 640;
                window.ClampToScreen();
            }
            window.Show();
            StartLog("window shown");
        }
        catch (Exception ex)
        {
            StartLog("FAILED " + ex);
            MessageBox.Show(
                "墨墨的小屋没有打开成功。\n\n" + ex.Message +
                "\n\n请确认程序目录中的 node、server、shared、web 文件夹完整。",
                "墨墨 · 启动失败", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try { _server?.DisposeAsync().AsTask().Wait(2000); } catch { }
        try { _mutex?.ReleaseMutex(); } catch { }
        _mutex?.Dispose();
        base.OnExit(e);
    }
}
