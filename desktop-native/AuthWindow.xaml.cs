using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using Brush = System.Windows.Media.Brush;
using Brushes = System.Windows.Media.Brushes;

namespace MomoPet;

public partial class AuthWindow : Window
{
    private readonly ApiClient _api;
    private readonly ServerHost _server;
    private bool _register;

    public AuthWindow(ApiClient api, ServerHost server)
    {
        _api = api;
        _server = server;
        InitializeComponent();
        var url = server.Urls.Count > 0 ? server.Urls[0].Url : server.BaseUrl;
        ServerInfo.Text = url + "/";
        SetMode(false);
        Loaded += (_, _) => UserBox.Focus();
        PreviewKeyDown += (_, e) =>
        {
            if (e.Key == Key.Escape) Close();
            else if (e.Key == Key.Enter && SubmitBtn.IsEnabled)
            {
                e.Handled = true;
                _ = SubmitAsync();
            }
        };
    }

    private void Card_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ButtonState == MouseButtonState.Pressed) DragMove();
    }

    private void Close_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }

    private void LoginTab_Click(object sender, RoutedEventArgs e) => SetMode(false);

    private void RegisterTab_Click(object sender, RoutedEventArgs e) => SetMode(true);

    private void SetMode(bool register)
    {
        _register = register;
        LoginTab.Background = register ? Brushes.Transparent : (Brush)FindResource("Ink");
        LoginTab.Foreground = register ? (Brush)FindResource("Muted") : (Brush)FindResource("Paper");
        RegisterTab.Background = register ? (Brush)FindResource("Ink") : Brushes.Transparent;
        RegisterTab.Foreground = register ? (Brush)FindResource("Paper") : (Brush)FindResource("Muted");
        ConfirmPanel.Visibility = register ? Visibility.Visible : Visibility.Collapsed;
        SubmitBtn.Content = register ? "创建并进入小屋" : "登录并进入小屋";
        ErrorText.Text = "";
    }

    private async void Submit_Click(object sender, RoutedEventArgs e)
    {
        await SubmitAsync();
    }

    private async Task SubmitAsync()
    {
        string username = UserBox.Text.Trim();
        string password = PassBox.Password;
        if (username.Length < 2)
        {
            ErrorText.Text = "账号至少 2 个字符";
            return;
        }
        if (password.Length < 6)
        {
            ErrorText.Text = "密码至少 6 位";
            return;
        }
        if (_register && ConfirmBox.Password != password)
        {
            ErrorText.Text = "两次输入的密码不一样";
            return;
        }

        SubmitBtn.IsEnabled = false;
        SubmitBtn.Content = _register ? "正在布置小屋…" : "正在开门…";
        ErrorText.Text = "";
        try
        {
            if (_register) await _api.RegisterAsync(username, password);
            else await _api.LoginAsync(username, password);
            DialogResult = true;
            Close();
        }
        catch (ApiException ex)
        {
            ErrorText.Text = ex.Message switch
            {
                "wrong_credentials" => "账号或密码不对",
                "username_taken" => "这个账号已经有人用了",
                "bad_username" => "账号要 2-20 个字符，可以用中文、字母、数字、_ 或 -",
                "bad_password" => "密码至少 6 位，最多 72 位",
                "too_many_tries" => "试太多次啦，等十分钟再来",
                "network" => "连不上这台电脑的本地服务",
                _ => "没有成功，再试一次吧"
            };
        }
        catch
        {
            ErrorText.Text = "连不上这台电脑的本地服务";
        }
        finally
        {
            SubmitBtn.IsEnabled = true;
            SubmitBtn.Content = _register ? "创建并进入小屋" : "登录并进入小屋";
        }
    }
}
