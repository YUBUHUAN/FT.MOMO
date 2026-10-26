using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using WinForms = System.Windows.Forms;
using Drawing = System.Drawing;
using Point = System.Windows.Point;
using Button = System.Windows.Controls.Button;
using MouseEventArgs = System.Windows.Input.MouseEventArgs;
using FontFamily = System.Windows.Media.FontFamily;
using Brush = System.Windows.Media.Brush;
using Color = System.Windows.Media.Color;
using TextBlock = System.Windows.Controls.TextBlock;
using Image = System.Windows.Controls.Image;
using CheckBox = System.Windows.Controls.CheckBox;
using ProgressBar = System.Windows.Controls.ProgressBar;
using ContextMenu = System.Windows.Controls.ContextMenu;
using MenuItem = System.Windows.Controls.MenuItem;
using TextAlignment = System.Windows.TextAlignment;

namespace MomoPet;

public partial class MainWindow : Window
{
    private readonly ServerHost _server;
    private readonly ApiClient _api;
    private readonly bool _smoke;
    private AppSettings _settings = new();
    private WinForms.NotifyIcon? _tray;

    private readonly DispatcherTimer _poll = new();
    private readonly DispatcherTimer _heartbeat = new();
    private readonly DispatcherTimer _awayTimer = new();
    private readonly DispatcherTimer _exerciseTimer = new();
    private readonly DispatcherTimer _bubbleHide = new();
    private readonly DispatcherTimer _typer = new();
    private readonly DispatcherTimer _tapFlush = new();
    private readonly DispatcherTimer _toastHide = new();

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    private readonly Random _rng = new();
    private string _bubbleFull = "";
    private int _bubbleIndex;
    private int _bubbleToken;
    private bool _bubbleIsDots;
    private string? _recapShownKey;
    private bool _polling;
    private bool _finishingAway;
    private bool _finishingExercise;
    private bool _exerciseStopping;
    private int _chartWeekOffset;
    private string _exerciseMotionKind = "";
    private DispatcherTimer? _sweatTimer;
    private DispatcherTimer? _exerciseLineTimer;
    private bool _busy;
    private bool _onlineToastShown;
    private bool _isAway;
    private bool _firstTipShown;
    private bool _bubbleShowing;
    private bool _closing;

    private int _combo;
    private int _burst;
    private DateTime _lastTapAt = DateTime.MinValue;
    private DateTime _lastBurstAt = DateTime.MinValue;
    private int _lastBurstCount;

    private bool _petDown;
    private bool _petDragging;
    private Point _dragStartScreen;
    private double _dragLeft;
    private double _dragTop;

    private byte[]? _petMask;
    private const int MaskSize = 96;

    private string _feedItemId = "";
    private string _feedOptionId = "";
    private string _feedItemName = "";
    private string _feedOptionLabel = "";
    private string _feedEmoji = "🍰";
    private Button? _feedFoot;

    private string _placeId = "";
    private string _placeName = "";
    private string _placeEmoji = "🌳";
    private int _placeMinutes = 10;
    private TextBlock? _outingPreview;
    private string _exerciseKindId = "";
    private string _exerciseName = "";
    private string _exerciseEmoji = "🏃";
    private int _exerciseMinutes = 3;
    private string _summaryType = "outing";
    private Button? _outingFoot;
    private ToggleButton? _duration10;
    private ToggleButton? _duration30;

    public MainWindow(ServerHost server, ApiClient api, bool smoke)
    {
        _server = server;
        _api = api;
        _smoke = smoke;
        InitializeComponent();
        _settings = SettingsStore.Load();
        TonePlayer.Enabled = _settings.Sound;
        Topmost = _settings.AlwaysOnTop;
        SetupTimers();
        SetupEvents();
        SourceInitialized += OnSourceInitialized;
        Loaded += OnLoaded;
        Closed += OnClosed;
        Sheet.SizeChanged += (_, _) =>
        {
            if (Sheet.ActualWidth > 80) SheetBody.Width = Math.Max(200, Sheet.ActualWidth - 64);
        };
    }

    private JsonNode? State => _api.State;
    private JsonNode? ContentData => _api.Content;

    private void SetupTimers()
    {
        _poll.Interval = TimeSpan.FromSeconds(4);
        _poll.Tick += async (_, _) => await PollAsync();
        _heartbeat.Interval = TimeSpan.FromSeconds(15);
        _heartbeat.Tick += async (_, _) => await HeartbeatAsync();
        _awayTimer.Interval = TimeSpan.FromSeconds(1);
        _awayTimer.Tick += (_, _) => AwayTick();
        _exerciseTimer.Interval = TimeSpan.FromSeconds(1);
        _exerciseTimer.Tick += (_, _) => ExerciseTick();
        _bubbleHide.Interval = TimeSpan.FromSeconds(5);
        _bubbleHide.Tick += (_, _) => HideBubble();
        _typer.Interval = TimeSpan.FromMilliseconds(26);
        _typer.Tick += (_, _) => TypeTick();
        _tapFlush.Interval = TimeSpan.FromMilliseconds(1050);
        _tapFlush.Tick += async (_, _) => await FlushTapsAsync();
        _toastHide.Interval = TimeSpan.FromSeconds(2.2);
        _toastHide.Tick += (_, _) =>
        {
            _toastHide.Stop();
            Toast.BeginAnimation(OpacityProperty, new DoubleAnimation(0, TimeSpan.FromMilliseconds(180)));
        };
    }

    private void SetupEvents()
    {
        Pet.MouseLeftButtonDown += Pet_MouseLeftButtonDown;
        Pet.MouseMove += Pet_MouseMove;
        Pet.MouseLeftButtonUp += Pet_MouseLeftButtonUp;
        Pet.LostMouseCapture += (_, _) => EndDrag(false);
        Pet.MouseRightButtonUp += (_, e) => { OpenMenu(); e.Handled = true; };

        FeedBtn.Click += (_, _) => OpenFeed();
        OutingBtn.Click += (_, _) => OpenOuting();
        ExerciseBtn.Click += (_, _) => OpenExercise();
        BackgroundBtn.Click += (_, _) => OpenBackgroundSheet();
        ProfileBtn.Click += (_, _) => OpenProfile();
        StopExerciseBtn.Click += (_, _) => _ = StopExerciseNowAsync();
        ExercisePeekBtn.Click += (_, _) => PeekExercise();
        MoodPill.MouseLeftButtonDown += (_, _) => OpenProfile();
        SheetClose.Click += (_, _) => CloseSheet();
        EarlyBtn.Click += (_, _) => AskEarlyBack();
        PeekBtn.Click += (_, _) => Peek();
        MouseRightButtonUp += (_, e) =>
        {
            if (e.OriginalSource is DependencyObject d && IsInside(d, Pet)) return;
            if (SheetLayer.Visibility == Visibility.Visible || ModalLayer.Visibility == Visibility.Visible) return;
            OpenMenu();
        };
    }

    private static bool IsInside(DependencyObject? node, DependencyObject parent)
    {
        while (node != null)
        {
            if (ReferenceEquals(node, parent)) return true;
            node = VisualTreeHelper.GetParent(node);
        }
        return false;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        BuildPetMask();
        RenderState();
        _poll.Start();
        _heartbeat.Start();
        _ = HeartbeatAsync();
        BeginBreathe();
        CreateTray();
        if (!_smoke) ClampToScreen();
        if (_smoke)
        {
            _ = RunSmokeAsync();
        }
        else
        {
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1600) };
            timer.Tick += (_, _) =>
            {
                timer.Stop();
                FirstTip();
            };
            timer.Start();
        }
    }

    public void ClampToScreen()
    {
        var wa = SystemParameters.WorkArea;
        if (double.IsNaN(Left) || double.IsNaN(Top))
        {
            Left = wa.Right - Width - 20;
            Top = wa.Bottom - Height - 10;
        }
        if (Left > wa.Right - 70) Left = wa.Right - Width - 16;
        if (Top > wa.Bottom - 70) Top = wa.Bottom - Height - 8;
        if (Left < wa.Left - Width + 70) Left = wa.Left;
        if (Top < wa.Top - Height + 70) Top = wa.Top;
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        _closing = true;
        _poll.Stop();
        _heartbeat.Stop();
        _awayTimer.Stop();
        _bubbleHide.Stop();
        _typer.Stop();
        _tapFlush.Stop();
        if (!_smoke)
        {
            _settings.Left = Left;
            _settings.Top = Top;
            SettingsStore.Save(_settings);
        }
        _tray?.Dispose();
        _tray = null;
    }

    /* ---------------------------------------------------------------- data */

    private async Task PollAsync()
    {
        if (_polling) return;
        _polling = true;
        try
        {
            await _api.GetStateAsync();
            SetOnline(true);
            RenderState();
        }
        catch
        {
            SetOnline(false);
        }
        finally
        {
            _polling = false;
        }
    }

    private async Task HeartbeatAsync()
    {
        try
        {
            JsonNode res = await _api.ActionAsync("heartbeat", new() { ["visible"] = IsVisible });
            _api.State = res["state"];
            SetOnline(true);
        }
        catch
        {
            SetOnline(false);
        }
    }

    private void SetOnline(bool online)
    {
        SyncDot.Fill = online ? (Brush)FindResource("SageDeep") : (Brush)FindResource("Danger");
        SyncDot.ToolTip = online ? "已和手机同步" : "离线 · 正在重连";
        if (!online && !_onlineToastShown)
        {
            _onlineToastShown = true;
            ShowToast("暂时连不上小屋，正在重试…");
        }
        if (online) _onlineToastShown = false;
    }

    private void RenderState()
    {
        JsonNode? s = State;
        if (s == null) return;
        string name = Str(s["name"], "", "墨墨");
        Title = name;

        double mood = Num(s, "mood", 64);
        JsonNode? label = MoodLabelNode(mood);
        MoodEmoji.Text = Str(label, "emoji", "🍃");
        MoodValue.Text = Math.Round(mood).ToString(CultureInfo.InvariantCulture);
        MoodPill.ToolTip = $"{Str(label, "label")} · {Str(label, "note")}";

        JsonNode? outingNode = s["outing"];
        bool away = outingNode is JsonObject;
        _isAway = away;
        if (outingNode is JsonObject outing)
        {
            Pet.Visibility = Visibility.Collapsed;
            PetShadow.Visibility = Visibility.Collapsed;
            Dock.Visibility = Visibility.Collapsed;
            BubbleWrap.Visibility = Visibility.Collapsed;
            AwayCard.Visibility = Visibility.Visible;
            ExerciseCard.Visibility = Visibility.Collapsed;
            _exerciseTimer.Stop();
            StopExerciseMotion();
            AwayEmoji.Text = Str(outing, "emoji", "🌳");
            AwayTitle.Text = "去" + Str(outing, "name", "公园") + "走走";
            AwayNote.Text = "不用等她，她会自己看时间。回来时会带一点小东西。";
            _awayTimer.Start();
            AwayTick();
        }
        else
        {
            Pet.Visibility = Visibility.Visible;
            PetShadow.Visibility = Visibility.Visible;
            AwayCard.Visibility = Visibility.Collapsed;
            _awayTimer.Stop();
            RenderExerciseState(s);
        }

        RenderScene(s);
        JsonNode? lastExercise = s["lastExercise"];
        JsonNode? lastOuting = s["lastOuting"];
        if (lastExercise != null && Bool(lastExercise, "unseen"))
        {
            string key = Str(lastExercise, "at", "");
            if (key != _recapShownKey && SheetLayer.Visibility != Visibility.Visible) ShowExerciseSummary(lastExercise);
        }
        else if (lastOuting != null && Bool(lastOuting, "unseen"))
        {
            string key = Str(lastOuting, "at", "");
            if (key != _recapShownKey && SheetLayer.Visibility != Visibility.Visible) ShowRecap(lastOuting);
        }
    }

    private void RenderScene(JsonNode s)
    {
        string id = Str(s, "background", "home");
        JsonNode? scene = null;
        if (ContentData?["SCENES"] is JsonArray scenes)
        {
            foreach (JsonNode? item in scenes)
            {
                if (item != null && Str(item, "id") == id) { scene = item; break; }
            }
        }
        scene ??= ContentData?["SCENES"]?[0];
        if (scene == null) return;
        Color wall1 = ParseColor(Str(scene["wall"]?[0], "#FBF1E7"));
        Color wall2 = ParseColor(Str(scene["wall"]?[1], "#F1DFD0"));
        Color floor = ParseColor(Str(scene, "floor", "#DCC4AE"));
        Color accent = ParseColor(Str(scene, "accent", "#C98F75"));
        ScenePanel.Background = new LinearGradientBrush(wall1, wall2, 90);
        SceneFloor.Background = new SolidColorBrush(floor);
        SceneRug.Fill = new SolidColorBrush(Color.FromArgb(88, accent.R, accent.G, accent.B));
        SceneWindow.Background = id == "rain"
            ? new SolidColorBrush(Color.FromArgb(255, 176, 185, 202))
            : new SolidColorBrush(Color.FromArgb(255, 220, 235, 236));
        SceneLamp.Text = id == "rain" ? "🕯" : "💡";
        ScenePlant.Text = id == "garden" ? "🌷" : "🪴";
        SceneHint.Text = $"{Str(scene, "emoji", "🏠")} {Str(scene, "name", "家")}";
        ScenePanel.Visibility = _isAway ? Visibility.Collapsed : Visibility.Visible;
    }

    private static Color ParseColor(string hex)
    {
        try { return (Color)System.Windows.Media.ColorConverter.ConvertFromString(hex); }
        catch { return Color.FromRgb(251, 241, 231); }
    }

    private void RenderExerciseState(JsonNode s)
    {
        if (s["exercise"] is not JsonObject ex)
        {
            ExerciseCard.Visibility = Visibility.Collapsed;
            _exerciseTimer.Stop();
            _finishingExercise = false;
            StopExerciseMotion();
            UpdateDockVisibility();
            return;
        }
        Pet.Visibility = Visibility.Visible;
        PetShadow.Visibility = Visibility.Visible;
        ExerciseCard.Visibility = Visibility.Visible;
        AwayCard.Visibility = Visibility.Collapsed;
        Dock.Visibility = Visibility.Collapsed;
        ExerciseTitle.Text = "正在" + Str(ex, "name", "运动");
        ExerciseNote.Text = Str(ex, "line", "正在运动……先别打扰她。");
        StartExerciseMotion(Str(ex, "kindId", "run"));
        ExerciseTick();
        _exerciseTimer.Start();
    }

    private void StartExerciseMotion(string kind)
    {
        if (_exerciseMotionKind == kind) return;
        StopExerciseMotion();
        _exerciseMotionKind = kind;
        int pace = kind switch
        {
            "rope" => 360,
            "run" => 520,
            "walk" => 720,
            _ => 1100
        };
        double bob = kind == "stretch" ? 2.5 : kind == "rope" ? 8 : 5;
        double tilt = kind == "stretch" ? 1.5 : kind == "rope" ? 2.5 : 1.8;

        var bounce = new DoubleAnimationUsingKeyFrames
        {
            Duration = TimeSpan.FromMilliseconds(pace),
            RepeatBehavior = RepeatBehavior.Forever
        };
        bounce.KeyFrames.Add(new EasingDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.Zero)));
        bounce.KeyFrames.Add(new EasingDoubleKeyFrame(-bob, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(pace * 0.42)),
            new QuadraticEase { EasingMode = EasingMode.EaseOut }));
        bounce.KeyFrames.Add(new EasingDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(pace)),
            new BounceEase { Bounces = 2, Bounciness = 2.4 }));
        PetTranslate.BeginAnimation(TranslateTransform.YProperty, bounce, HandoffBehavior.SnapshotAndReplace);

        var swing = new DoubleAnimation(-tilt, tilt, TimeSpan.FromMilliseconds(pace))
        {
            AutoReverse = true,
            RepeatBehavior = RepeatBehavior.Forever,
            EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
        };
        PetRotate.BeginAnimation(RotateTransform.AngleProperty, swing, HandoffBehavior.SnapshotAndReplace);

        var squash = new DoubleAnimation(1, 1.018, TimeSpan.FromMilliseconds(pace / 2.0))
        {
            AutoReverse = true,
            RepeatBehavior = RepeatBehavior.Forever,
            EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
        };
        PetScale.BeginAnimation(ScaleTransform.ScaleYProperty, squash, HandoffBehavior.SnapshotAndReplace);

        _exerciseLineTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2.6) };
        _exerciseLineTimer.Tick += (_, _) =>
        {
            JsonNode? ex = State?["exercise"];
            if (ex == null) return;
            string k = Str(ex, "kindId", "run");
            string line = PickLines(ContentData?["EXERCISE_STATUS_LINES"]?[k]);
            if (!string.IsNullOrWhiteSpace(line)) ExerciseNote.Text = line;
        };
        _exerciseLineTimer.Start();

        if (kind != "stretch")
        {
            _sweatTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(kind == "rope" ? 520 : 680) };
            _sweatTimer.Tick += (_, _) => SpawnSweat(kind);
            _sweatTimer.Start();
        }
    }

    private void StopExerciseMotion()
    {
        _sweatTimer?.Stop();
        _sweatTimer = null;
        _exerciseLineTimer?.Stop();
        _exerciseLineTimer = null;
        if (string.IsNullOrEmpty(_exerciseMotionKind)) return;
        _exerciseMotionKind = "";
        PetTranslate.BeginAnimation(TranslateTransform.YProperty, null);
        PetRotate.BeginAnimation(RotateTransform.AngleProperty, null);
        PetScale.BeginAnimation(ScaleTransform.ScaleYProperty, null);
        PetTranslate.Y = 0;
        PetRotate.Angle = 0;
        PetScale.ScaleY = 1;
        BeginBreathe();
    }

    private void SpawnSweat(string kind)
    {
        if (State?["exercise"] == null) return;
        var t = new TextBlock
        {
            Text = kind == "stretch" ? "✦" : "💧",
            FontFamily = (FontFamily)FindResource("EmojiFont"),
            FontSize = 11 + _rng.NextDouble() * 7,
            Foreground = kind == "stretch" ? (Brush)FindResource("BlushDeep") : (Brush)FindResource("SageDeep"),
            Opacity = 0,
            IsHitTestVisible = false
        };
        Canvas.SetLeft(t, 170 + _rng.NextDouble() * 120);
        Canvas.SetTop(t, 360 + _rng.NextDouble() * 90);
        FxLayer.Children.Add(t);
        var fade = new DoubleAnimationUsingKeyFrames { Duration = TimeSpan.FromMilliseconds(1050) };
        fade.KeyFrames.Add(new LinearDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.Zero)));
        fade.KeyFrames.Add(new LinearDoubleKeyFrame(0.9, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(130))));
        fade.KeyFrames.Add(new LinearDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(1050))));
        t.BeginAnimation(OpacityProperty, fade);
        var tt = new TranslateTransform();
        t.RenderTransform = tt;
        var fall = new DoubleAnimation(0, 35 + _rng.Next(20), TimeSpan.FromMilliseconds(1050))
        {
            EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseIn }
        };
        tt.BeginAnimation(TranslateTransform.YProperty, fall);
        var drift = new DoubleAnimation(0, _rng.Next(-12, 12), TimeSpan.FromMilliseconds(1050));
        tt.BeginAnimation(TranslateTransform.XProperty, drift);
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1100) };
        timer.Tick += (_, _) => { timer.Stop(); FxLayer.Children.Remove(t); };
        timer.Start();
    }

    private void ExerciseTick()
    {
        JsonNode? ex = State?["exercise"];
        if (ex == null)
        {
            _exerciseTimer.Stop();
            return;
        }
        long left = Long(ex, "endsAt") - NowMs();
        ExerciseCount.Text = FormatClock(left);
        if (left <= 0 && !_finishingExercise)
        {
            _finishingExercise = true;
            _exerciseTimer.Stop();
            _ = FinishExerciseAutoAsync();
        }
    }

    private async Task FinishExerciseAutoAsync()
    {
        try
        {
            await _api.GetStateAsync();
            RenderState();
        }
        catch { SetOnline(false); }
        finally { _finishingExercise = false; }
    }

    private void PeekExercise()
    {
        JsonNode? ex = State?["exercise"];
        if (ex == null) return;
        string kind = Str(ex, "kindId", "run");
        var lines = new List<string>();
        if (ContentData?["EXERCISE_STATUS_LINES"]?[kind] is JsonArray arr)
        {
            foreach (JsonNode? item in arr)
            {
                string? line = item?.GetValue<string>();
                if (!string.IsNullOrWhiteSpace(line)) lines.Add(line);
            }
        }
        ShowBubble(lines.Count > 0 ? lines[_rng.Next(lines.Count)] : "正在运动，先别打扰我。", 4200);
        TonePlayer.Tap(2);
    }

    private void AskStopExercise()
    {
        JsonNode? ex = State?["exercise"];
        if (ex == null) return;
        ShowConfirm("要让她停下吗？",
            $"她正在{Str(ex, "name", "运动")}。现在停下只能拿到一部分健康值，不过运动记录会留下来。",
            "让她停下",
            () => _ = StopExerciseNowAsync());
    }

    private async Task StopExerciseNowAsync()
    {
        if (_exerciseStopping || State?["exercise"] == null) return;
        _exerciseStopping = true;
        StopExerciseBtn.IsEnabled = false;
        try
        {
            JsonNode res = await _api.ActionAsync("exercise_finish", new() { ["early"] = true });
            _api.State = res["state"];
            RenderState();
            JsonNode? result = res["result"];
            if (result != null)
            {
                TonePlayer.Feed();
                ShowExerciseSummary(result);
            }
            else
            {
                ShowToast("她停下来了");
            }
        }
        catch (ApiException ex2)
        {
            ShowToast(ex2.Message == "not_exercising" ? "她已经停下来了" : "现在还说不上话");
        }
        catch
        {
            SetOnline(false);
            ShowToast("连不上小屋，等会儿再试");
        }
        finally
        {
            _exerciseStopping = false;
            StopExerciseBtn.IsEnabled = true;
        }
    }

    /* ---------------------------------------------------------------- taps */

    private void Pet_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ClickCount == 2)
        {
            e.Handled = true;
            OpenProfile();
            return;
        }
        _petDown = true;
        _petDragging = false;
        _dragStartScreen = PointToScreen(e.GetPosition(this));
        _dragLeft = Left;
        _dragTop = Top;
        Pet.CaptureMouse();
        e.Handled = true;
    }

    private void Pet_MouseMove(object sender, MouseEventArgs e)
    {
        if (!_petDown) return;
        Point now = PointToScreen(e.GetPosition(this));
        DpiScale dpi = VisualTreeHelper.GetDpi(this);
        double dx = (now.X - _dragStartScreen.X) / dpi.DpiScaleX;
        double dy = (now.Y - _dragStartScreen.Y) / dpi.DpiScaleY;
        if (!_petDragging && Math.Abs(dx) + Math.Abs(dy) > 5) _petDragging = true;
        if (_petDragging)
        {
            Left = _dragLeft + dx;
            Top = _dragTop + dy;
        }
    }

    private void Pet_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (!_petDown) return;
        bool dragged = _petDragging;
        EndDrag(true);
        if (!dragged) Tap();
        e.Handled = true;
    }

    private void EndDrag(bool save)
    {
        _petDown = false;
        _petDragging = false;
        if (Pet.IsMouseCaptured) Pet.ReleaseMouseCapture();
        if (save)
        {
            ClampToScreen();
            _settings.Left = Left;
            _settings.Top = Top;
            SettingsStore.Save(_settings);
        }
    }

    private void Tap()
    {
        if (_isAway)
        {
            Peek();
            return;
        }
        if (State?["exercise"] != null)
        {
            PeekExercise();
            return;
        }
        DateTime now = DateTime.UtcNow;
        _combo = (now - _lastTapAt).TotalMilliseconds < 1150 ? _combo + 1 : 1;
        _lastTapAt = now;
        _burst++;
        if (_combo > 1)
        {
            TonePlayer.Tap(_combo);
            ShowDots(_combo);
            Shake();
            if (_combo >= 3) SpawnHearts(Math.Min(4, _combo / 2));
        }
        else
        {
            TonePlayer.Tap(1);
            string line = (_lastBurstCount >= 6 && (DateTime.UtcNow - _lastBurstAt).TotalSeconds < 9 && _rng.NextDouble() < 0.85)
                ? PickLines(ContentData?["TAP_LINES"]?["after_spam"])
                : PickTapLine();
            ShowBubble(line, 5600);
            Bounce();
            SpawnHearts(3);
        }
        _tapFlush.Stop();
        _tapFlush.Start();
    }

    private void ShowDots(int combo)
    {
        int n = Math.Clamp(combo, 1, 24);
        string dots = string.Join(" ", Enumerable.Repeat("。", n));
        string mark = "";
        if (combo >= 7 && ContentData?["SPAM_MARKS"] is JsonArray marks && marks.Count > 0)
        {
            int idx = Math.Min(marks.Count - 1, (combo - 7) / 4);
            mark = marks[idx]?.GetValue<string>() ?? "";
        }
        ShowBubble(dots, 3200, mark, dots: true);
    }

    private async Task FlushTapsAsync()
    {
        _tapFlush.Stop();
        int count = _burst;
        _burst = 0;
        if (count <= 0) return;
        _lastBurstCount = count;
        _lastBurstAt = DateTime.UtcNow;
        try
        {
            JsonNode res = await _api.ActionAsync("tap", new() { ["count"] = count });
            _api.State = res["state"];
            SetOnline(true);
            RenderState();
        }
        catch
        {
            SetOnline(false);
        }
    }

    private string PickTapLine()
    {
        JsonNode? tap = ContentData?["TAP_LINES"];
        var pool = new List<string>();
        if (tap == null) return "……我在。";
        DateTime lastTalk = ParseTime(Str(State?["lastInteractionAt"], "", ""));
        if (lastTalk != DateTime.MinValue && (DateTime.UtcNow - lastTalk).TotalMinutes > 45)
            AddLines(pool, tap["idle"]);
        int hour = DateTime.Now.Hour;
        if (hour >= 23 || hour < 5) AddLines(pool, tap["night"]);
        if (hour >= 6 && hour < 10) AddLines(pool, tap["morning"]);
        double mood = Num(State, "mood", 64);
        if (mood <= 35)
        {
            AddLines(pool, tap["low"]);
            AddLines(pool, tap["low"]);
        }
        if (mood >= 75) AddLines(pool, tap["happy"]);
        AddLines(pool, tap["soft"]);
        AddLines(pool, tap["soft"]);
        return pool.Count > 0 ? pool[_rng.Next(pool.Count)] : "……我在。";
    }

    private string PickLines(JsonNode? node)
    {
        var list = new List<string>();
        AddLines(list, node);
        return list.Count > 0 ? list[_rng.Next(list.Count)] : "……";
    }

    private static void AddLines(List<string> pool, JsonNode? node)
    {
        if (node is JsonArray arr)
        {
            foreach (JsonNode? item in arr)
            {
                string? s = item?.GetValue<string>();
                if (!string.IsNullOrWhiteSpace(s)) pool.Add(s);
            }
        }
    }

    private void BeginBreathe()
    {
        var sx = new DoubleAnimation(1, 1.008, TimeSpan.FromSeconds(2.8))
        {
            AutoReverse = true,
            RepeatBehavior = RepeatBehavior.Forever,
            EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
        };
        var sy = new DoubleAnimation(1, 1.014, TimeSpan.FromSeconds(2.8))
        {
            AutoReverse = true,
            RepeatBehavior = RepeatBehavior.Forever,
            EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
        };
        PetScale.BeginAnimation(ScaleTransform.ScaleXProperty, sx);
        PetScale.BeginAnimation(ScaleTransform.ScaleYProperty, sy);
    }

    private void Bounce()
    {
        var anim = new DoubleAnimationUsingKeyFrames();
        anim.KeyFrames.Add(new EasingDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.Zero)));
        anim.KeyFrames.Add(new EasingDoubleKeyFrame(-13, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(110)),
            new QuadraticEase { EasingMode = EasingMode.EaseOut }));
        anim.KeyFrames.Add(new EasingDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(420)),
            new BounceEase { Bounces = 2, Bounciness = 3 }));
        PetTranslate.BeginAnimation(TranslateTransform.YProperty, anim);
    }

    private void Shake()
    {
        var anim = new DoubleAnimationUsingKeyFrames { Duration = TimeSpan.FromMilliseconds(430) };
        anim.KeyFrames.Add(new EasingDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.Zero)));
        anim.KeyFrames.Add(new EasingDoubleKeyFrame(-3.2, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(80))));
        anim.KeyFrames.Add(new EasingDoubleKeyFrame(3.0, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(190))));
        anim.KeyFrames.Add(new EasingDoubleKeyFrame(-1.6, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(300))));
        anim.KeyFrames.Add(new EasingDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(430))));
        PetRotate.BeginAnimation(RotateTransform.AngleProperty, anim);
    }

    private void SpawnHearts(int count)
    {
        string[] glyphs = { "♡", "❤", "✦", "·" };
        for (int i = 0; i < count; i++)
        {
            var t = new TextBlock
            {
                Text = glyphs[_rng.Next(glyphs.Length)],
                FontSize = 16 + _rng.NextDouble() * 7,
                Foreground = (Brush)FindResource(_rng.NextDouble() < 0.35 ? "Ink" : "BlushDeep"),
                Opacity = 0,
                IsHitTestVisible = false
            };
            double x = 140 + _rng.NextDouble() * 100;
            double y = 370 + _rng.NextDouble() * 40;
            Canvas.SetLeft(t, x);
            Canvas.SetTop(t, y);
            var tt = new TranslateTransform();
            t.RenderTransform = tt;
            FxLayer.Children.Add(t);
            var fade = new DoubleAnimationUsingKeyFrames { Duration = TimeSpan.FromMilliseconds(1200) };
            fade.KeyFrames.Add(new LinearDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.Zero)));
            fade.KeyFrames.Add(new LinearDoubleKeyFrame(1, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(140))));
            fade.KeyFrames.Add(new LinearDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(1200))));
            t.BeginAnimation(OpacityProperty, fade);
            var up = new DoubleAnimation(0, -90 - _rng.Next(70), TimeSpan.FromMilliseconds(1200))
            {
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
            };
            tt.BeginAnimation(TranslateTransform.YProperty, up);
            var drift = new DoubleAnimation(0, _rng.Next(-25, 25), TimeSpan.FromMilliseconds(1200));
            tt.BeginAnimation(TranslateTransform.XProperty, drift);
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1250) };
            timer.Tick += (_, _) =>
            {
                timer.Stop();
                FxLayer.Children.Remove(t);
            };
            timer.Start();
        }
    }

    private void SpawnFood(string emoji)
    {
        var t = new TextBlock
        {
            Text = emoji,
            FontFamily = (FontFamily)FindResource("EmojiFont"),
            FontSize = 26,
            IsHitTestVisible = false
        };
        Canvas.SetLeft(t, 172);
        Canvas.SetTop(t, 470);
        FxLayer.Children.Add(t);
        var fade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(900)) { BeginTime = TimeSpan.FromMilliseconds(240) };
        t.BeginAnimation(OpacityProperty, fade);
        var up = new DoubleAnimation(0, -55, TimeSpan.FromMilliseconds(1000)) { EasingFunction = new CubicEase() };
        var tt = new TranslateTransform();
        t.RenderTransform = tt;
        tt.BeginAnimation(TranslateTransform.YProperty, up);
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1100) };
        timer.Tick += (_, _) =>
        {
            timer.Stop();
            FxLayer.Children.Remove(t);
        };
        timer.Start();
    }

    private void Chew()
    {
        var anim = new DoubleAnimationUsingKeyFrames { Duration = TimeSpan.FromMilliseconds(520) };
        anim.KeyFrames.Add(new EasingDoubleKeyFrame(1, KeyTime.FromTimeSpan(TimeSpan.Zero)));
        anim.KeyFrames.Add(new EasingDoubleKeyFrame(0.965, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(180))));
        anim.KeyFrames.Add(new EasingDoubleKeyFrame(1.02, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(360))));
        anim.KeyFrames.Add(new EasingDoubleKeyFrame(1, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(520))));
        PetScale.BeginAnimation(ScaleTransform.ScaleYProperty, anim, HandoffBehavior.SnapshotAndReplace);
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(560) };
        timer.Tick += (_, _) =>
        {
            timer.Stop();
            BeginBreathe();
        };
        timer.Start();
    }

    /* --------------------------------------------------------------- bubble */

    private void ShowBubble(string text, int ms = 5000, string mark = "", bool dots = false)
    {
        _bubbleToken++;
        int token = _bubbleToken;
        _bubbleIsDots = dots;
        _bubbleFull = text;
        _bubbleIndex = 0;
        _bubbleHide.Stop();
        _typer.Stop();
        BubbleWrap.Visibility = Visibility.Visible;
        _bubbleShowing = true;
        if (!_isAway) Dock.Visibility = Visibility.Collapsed;
        BubbleMark.Text = mark;
        BubbleMark.Visibility = string.IsNullOrWhiteSpace(mark) ? Visibility.Collapsed : Visibility.Visible;
        BubbleText.FontFamily = dots ? new FontFamily("Georgia") : (FontFamily)FindResource("HandFont");
        BubbleText.FontSize = dots ? 28 : 15.5;
        BubbleText.LineHeight = dots ? 34 : 27;
        BubbleText.TextAlignment = dots ? TextAlignment.Center : TextAlignment.Left;
        BubbleText.Text = dots ? text : "";
        if (dots)
        {
            _typer.Stop();
        }
        else
        {
            _typer.Start();
        }
        var fade = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(160));
        BubbleWrap.BeginAnimation(OpacityProperty, fade);
        var slide = new DoubleAnimation(8, 0, TimeSpan.FromMilliseconds(230))
        {
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
        };
        BubbleTranslate.BeginAnimation(TranslateTransform.YProperty, slide);
        _bubbleHide.Interval = TimeSpan.FromMilliseconds(Math.Max(1200, ms));
        _bubbleHide.Start();
        _ = token;
    }

    private void TypeTick()
    {
        if (_bubbleIsDots) { _typer.Stop(); return; }
        _bubbleIndex++;
        if (_bubbleIndex >= _bubbleFull.Length)
        {
            BubbleText.Text = _bubbleFull;
            _typer.Stop();
            return;
        }
        BubbleText.Text = _bubbleFull[.._bubbleIndex];
    }

    private void HideBubble()
    {
        _bubbleHide.Stop();
        _typer.Stop();
        _bubbleShowing = false;
        UpdateDockVisibility();
        var fade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(180));
        fade.Completed += (_, _) => BubbleWrap.Visibility = Visibility.Collapsed;
        BubbleWrap.BeginAnimation(OpacityProperty, fade);
    }

    /* --------------------------------------------------------------- toast */

    private void ShowToast(string text)
    {
        ToastText.Text = text;
        Toast.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(160)));
        _toastHide.Stop();
        _toastHide.Start();
    }

    private void MoodToast(string text)
    {
        ShowToast(text);
    }

    /* --------------------------------------------------------------- away */

    private void AwayTick()
    {
        JsonNode? outing = State?["outing"];
        if (outing == null)
        {
            _awayTimer.Stop();
            return;
        }
        long ends = Long(outing, "endsAt");
        long left = ends - NowMs();
        AwayCount.Text = FormatClock(left);
        if (left <= 0 && !_finishingAway)
        {
            _awayTimer.Stop();
            _ = FinishAwayAsync();
        }
    }

    private async Task FinishAwayAsync()
    {
        if (_finishingAway) return;
        _finishingAway = true;
        try
        {
            await _api.GetStateAsync();
            RenderState();
        }
        catch { SetOnline(false); }
        finally { _finishingAway = false; }
    }

    private void Peek()
    {
        TonePlayer.Open();
        string? placeId = State?["outing"]?["placeId"]?.GetValue<string>();
        string line = "";
        if (ContentData?["OUTINGS"] is JsonArray places)
        {
            foreach (JsonNode? place in places)
            {
                if (place != null && Str(place, "id") == placeId)
                {
                    line = PickLines(place["peek"]);
                    break;
                }
            }
        }
        ShowBubble(string.IsNullOrEmpty(line) ? "这里的风很好。我坐一会儿就回去。" : line, 4200);
    }

    private void AskEarlyBack()
    {
        if (State?["outing"] == null) return;
        ShowConfirm("要提前回来吗？", "她还没逛完。提前回来只能拿到一部分心情值，不过……她应该会想见你。", "让她回来", async () =>
        {
            try
            {
                JsonNode res = await _api.ActionAsync("outing_finish", new() { ["early"] = true });
                _api.State = res["state"];
                RenderState();
                JsonNode? result = res["result"];
                if (result != null && !Bool(result, "cancelled"))
                {
                    TonePlayer.Feed();
                    ShowRecap(result);
                }
                else if (result != null)
                {
                    ShowBubble(Str(result, "line", "刚出门就回来了。"), 4200);
                }
            }
            catch (ApiException) { ShowToast("她已经回来了"); }
            catch { SetOnline(false); }
        });
    }

    /* --------------------------------------------------------------- recap */

    private void ShowRecap(JsonNode result)
    {
        _summaryType = "outing";
        Dock.Visibility = Visibility.Collapsed;
        string key = Str(result, "at", "");
        _recapShownKey = key;
        HideBubble();
        var panel = new StackPanel();
        panel.Children.Add(Txt("TRAVEL NOTE", 8.5, "Muted", null, new FontFamily("Georgia")));
        panel.Children.Add(Txt(Str(result, "name", "出门走走"), 23, "Ink", (FontFamily)FindResource("HandFont"), null, 0, 5));
        panel.Children.Add(Txt($"{FormatDate(Str(result, "at"))} · {Num(result, "actualMinutes", Num(result, "minutes", 10)):0} 分钟", 10.5, "Muted"));
        panel.Children.Add(Txt(Str(result, "emoji", "🌿"), 38, "Ink", (FontFamily)FindResource("EmojiFont"), null, 0, 10));
        panel.Children.Add(Txt(Str(result, "line", "我回来了。"), 15, "Ink", (FontFamily)FindResource("HandFont"), null, 0, 8, true));
        string surprise = Str(result, "surprise");
        if (!string.IsNullOrWhiteSpace(surprise))
        {
            panel.Children.Add(Txt("路上遇到：" + surprise, 11, "Ink2", (FontFamily)FindResource("HandFont"), null, 0, 8, true));
        }
        var chips = new WrapPanel { Margin = new Thickness(0, 10, 0, 0) };
        chips.Children.Add(Chip($"心情 +{Num(result, "moodDelta"):0.#}"));
        chips.Children.Add(Chip($"饱腹 −{Num(result, "fullnessDelta"):0.#}"));
        if (Bool(result, "early")) chips.Children.Add(Chip("提前回家"));
        panel.Children.Add(chips);
        panel.Children.Add(new Border { Height = 1, Background = (Brush)FindResource("Line"), Margin = new Thickness(0, 14, 0, 12) });
        var foot = new Grid();
        foot.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        foot.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var souvenir = new StackPanel();
        souvenir.Children.Add(Txt("带回来的小东西", 8.5, "Muted", null, new FontFamily("Georgia")));
        souvenir.Children.Add(Txt($"{Str(result, "souvenir", "🍃")} 放进了手账", 13, "Ink", (FontFamily)FindResource("HandFont")));
        Grid.SetColumn(souvenir, 0);
        var ok = new Button { Content = "收好", Style = (Style)FindResource("SmallButton") };
        ok.Click += (_, _) =>
        {
            HideModal();
            _ = MarkRecapSeenAsync();
        };
        Grid.SetColumn(ok, 1);
        foot.Children.Add(souvenir);
        foot.Children.Add(ok);
        panel.Children.Add(foot);
        ShowModal(panel);
        TonePlayer.Recap();
    }

    private void ShowExerciseSummary(JsonNode result)
    {
        _summaryType = "exercise";
        Dock.Visibility = Visibility.Collapsed;
        string key = Str(result, "at", "");
        _recapShownKey = key;
        HideBubble();
        var panel = new StackPanel();
        panel.Children.Add(Txt(Bool(result, "early") ? "CUT SHORT" : "EXERCISE NOTE", 8.5, "Muted", null, new FontFamily("Georgia")));
        panel.Children.Add(Txt($"{Str(result, "emoji", "🏃")} {Str(result, "name", "运动")}", 23, "Ink", (FontFamily)FindResource("HandFont"), null, 0, 5));
        panel.Children.Add(Txt($"{FormatDate(Str(result, "at"))} · {Num(result, "actualMinutes", Num(result, "minutes", 3)):0} 分钟", 10.5, "Muted"));
        panel.Children.Add(Txt(Str(result, "emoji", "🏃"), 38, "Ink", (FontFamily)FindResource("EmojiFont"), null, 0, 10));
        panel.Children.Add(Txt(Str(result, "line", "运动完了。"), 15, "Ink", (FontFamily)FindResource("HandFont"), null, 0, 8, true));
        var chips = new WrapPanel { Margin = new Thickness(0, 10, 0, 0) };
        chips.Children.Add(Chip($"健康 +{Num(result, "healthDelta"):0.#}"));
        chips.Children.Add(Chip($"疲惫 +{Num(result, "fatigueDelta"):0.#}"));
        chips.Children.Add(Chip($"心情 +{Num(result, "moodDelta"):0.#}"));
        if (Bool(result, "early")) chips.Children.Add(Chip("提前停下"));
        panel.Children.Add(chips);
        panel.Children.Add(new Border { Height = 1, Background = (Brush)FindResource("Line"), Margin = new Thickness(0, 14, 0, 12) });
        var foot = new Grid();
        foot.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        foot.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var note = new StackPanel();
        note.Children.Add(Txt("运动记录", 8.5, "Muted", null, new FontFamily("Georgia")));
        note.Children.Add(Txt(Bool(result, "early") ? "已记录 · 下次慢慢来" : "已写进手账", 13, "Ink", (FontFamily)FindResource("HandFont")));
        Grid.SetColumn(note, 0);
        var ok = new Button { Content = "收好", Style = (Style)FindResource("SmallButton") };
        ok.Click += (_, _) =>
        {
            HideModal();
            _ = MarkRecapSeenAsync();
        };
        Grid.SetColumn(ok, 1);
        foot.Children.Add(note);
        foot.Children.Add(ok);
        panel.Children.Add(foot);
        ShowModal(panel);
        TonePlayer.Recap();
    }

    private async Task MarkRecapSeenAsync()
    {
        try
        {
            JsonNode res = await _api.ActionAsync(_summaryType == "exercise" ? "exercise_seen" : "outing_seen");
            _api.State = res["state"];
        }
        catch { }
    }

    /* --------------------------------------------------------------- feed */

    private void OpenFeed()
    {
        if (_isAway)
        {
            ShowToast("她还在外面，回来再喂吧");
            return;
        }
        if (State?["exercise"] != null)
        {
            ShowToast("她正在运动，等会儿再吃吧");
            return;
        }
        TonePlayer.Open();
        _feedItemId = "";
        _feedOptionId = "";
        _feedFoot = new Button
        {
            Content = "选一样吃的吧",
            Style = (Style)FindResource("PrimaryButton"),
            IsEnabled = false,
            HorizontalAlignment = System.Windows.HorizontalAlignment.Stretch
        };
        _feedFoot.Click += async (_, _) => await FeedAsync();

        var body = new StackPanel();
        body.Children.Add(Txt("她不会说很多漂亮话，但会认真尝。吃太饱的话，可能会吃不下哦。", 10.5, "Muted", null, null, 0, 10, true));

        var rows = new List<ToggleButton>();
        var panels = new List<FrameworkElement>();
        var chipsAll = new List<ToggleButton>();

        if (ContentData?["FEED"] is JsonArray items)
        {
            foreach (JsonNode? itemNode in items)
            {
                if (itemNode == null) continue;
                string itemId = Str(itemNode, "id");
                string itemName = Str(itemNode, "name");
                string itemEmoji = Str(itemNode, "emoji", "🍰");
                string hint = Str(itemNode, "hint");

                var rowContent = new Grid();
                rowContent.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(48) });
                rowContent.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                rowContent.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var emojiBox = new Border
                {
                    Width = 42, Height = 42, CornerRadius = new CornerRadius(13),
                    Background = (Brush)FindResource("Paper2"),
                    Child = Txt(itemEmoji, 24, "Ink", (FontFamily)FindResource("EmojiFont"))
                };
                var texts = new StackPanel { VerticalAlignment = System.Windows.VerticalAlignment.Center, Margin = new Thickness(10, 0, 0, 0) };
                texts.Children.Add(Txt(itemName, 14, "Ink", null, null, 0, 1));
                texts.Children.Add(Txt(hint, 10, "Muted"));
                var plus = Txt("＋", 12, "Muted");
                plus.VerticalAlignment = System.Windows.VerticalAlignment.Center;
                Grid.SetColumn(emojiBox, 0);
                Grid.SetColumn(texts, 1);
                Grid.SetColumn(plus, 2);
                rowContent.Children.Add(emojiBox);
                rowContent.Children.Add(texts);
                rowContent.Children.Add(plus);

                var row = new ToggleButton
                {
                    Style = (Style)FindResource("RowToggle"),
                    Content = rowContent
                };
                var optionPanel = new WrapPanel { Visibility = Visibility.Collapsed, Margin = new Thickness(0, 0, 0, 6) };
                var itemChips = new List<ToggleButton>();
                if (itemNode["options"] is JsonArray options)
                {
                    foreach (JsonNode? opt in options)
                    {
                        if (opt == null) continue;
                        string optId = Str(opt, "id");
                        string optLabel = Str(opt, "label");
                        var chip = new ToggleButton
                        {
                            Content = optLabel,
                            Style = (Style)FindResource("ChipToggle")
                        };
                        chip.Checked += (_, _) =>
                        {
                            foreach (var other in itemChips) if (!ReferenceEquals(other, chip)) other.IsChecked = false;
                            foreach (var other in chipsAll) if (!ReferenceEquals(other, chip)) other.IsChecked = false;
                            _feedItemId = itemId;
                            _feedItemName = itemName;
                            _feedEmoji = itemEmoji;
                            _feedOptionId = optId;
                            _feedOptionLabel = optLabel;
                            if (_feedFoot != null)
                            {
                                _feedFoot.IsEnabled = true;
                                _feedFoot.Content = $"把{itemName}（{optLabel}）喂给她";
                            }
                        };
                        itemChips.Add(chip);
                        chipsAll.Add(chip);
                        optionPanel.Children.Add(chip);
                    }
                }

                row.Checked += (_, _) =>
                {
                    foreach (var other in rows) if (!ReferenceEquals(other, row)) other.IsChecked = false;
                    foreach (var p in panels) p.Visibility = ReferenceEquals(p, optionPanel) ? Visibility.Visible : Visibility.Collapsed;
                    _feedItemId = itemId;
                    _feedItemName = itemName;
                    _feedEmoji = itemEmoji;
                    _feedOptionId = "";
                    foreach (var chip in itemChips) chip.IsChecked = false;
                    if (_feedFoot != null)
                    {
                        _feedFoot.IsEnabled = false;
                        _feedFoot.Content = "选一个口味";
                    }
                };
                row.Unchecked += (_, _) =>
                {
                    optionPanel.Visibility = Visibility.Collapsed;
                };
                rows.Add(row);
                panels.Add(optionPanel);
                body.Children.Add(row);
                body.Children.Add(optionPanel);
            }
        }
        OpenSheet("投喂", "先看看她想吃什么", body, _feedFoot);
    }

    private async Task FeedAsync()
    {
        if (_busy || string.IsNullOrEmpty(_feedItemId) || string.IsNullOrEmpty(_feedOptionId)) return;
        _busy = true;
        try
        {
            JsonNode res = await _api.ActionAsync("feed", new()
            {
                ["itemId"] = _feedItemId,
                ["optionId"] = _feedOptionId
            });
            _api.State = res["state"];
            JsonNode? result = res["result"];
            CloseSheet();
            RenderState();
            if (result != null)
            {
                string line = Str(result, "line", "……");
                ShowBubble(line, 6200);
                if (Bool(result, "refused"))
                {
                    TonePlayer.Error();
                    MoodToast("她真的吃不下了");
                }
                else
                {
                    SpawnFood(_feedEmoji);
                    Chew();
                    TonePlayer.Feed();
                    MoodToast($"心情 +{Num(result, "moodDelta"):0.#} · 饱食 +{Num(result, "fullnessDelta"):0.#} · 健康 +{Num(result, "healthDelta"):0.#}");
                }
            }
        }
        catch (ApiException ex)
        {
            CloseSheet();
            ShowToast(ex.Message == "away" ? "她还在外面呢" : ex.Message == "busy" ? "她正在运动，等会儿再吃吧" : "现在吃不了东西");
        }
        catch
        {
            SetOnline(false);
            ShowToast("连不上小屋，等会儿再试试");
        }
        finally
        {
            _busy = false;
        }
    }

    /* --------------------------------------------------------------- outing */

    private void OpenOuting()
    {
        if (_isAway)
        {
            ShowToast("她已经出门啦");
            return;
        }
        if (State?["exercise"] != null)
        {
            ShowToast("她正在运动，先让她动完吧");
            return;
        }
        TonePlayer.Open();
        JsonNode? last = State?["lastOuting"];
        string lastPlace = last != null ? Str(last, "placeId") : "";
        _placeId = "";
        _placeMinutes = 10;

        var body = new StackPanel();
        body.Children.Add(Txt("她会自己看时间，也会带一点小东西回来。", 10.5, "Muted", null, null, 0, 10, true));

        var placesWrap = new WrapPanel();
        var placeCards = new List<ToggleButton>();
        if (ContentData?["OUTINGS"] is JsonArray places)
        {
            foreach (JsonNode? place in places)
            {
                if (place == null) continue;
                string id = Str(place, "id");
                string name = Str(place, "name");
                string emoji = Str(place, "emoji", "🌳");
                string blurb = Str(place, "blurb");
                var content = new StackPanel();
                content.Children.Add(Txt(emoji, 22, "Ink", (FontFamily)FindResource("EmojiFont")));
                content.Children.Add(Txt(name, 13, "Ink", null, null, 0, 2));
                content.Children.Add(Txt(blurb, 9.5, "Muted", null, null, 0, 0, true));
                var card = new ToggleButton
                {
                    Style = (Style)FindResource("PlaceToggle"),
                    Content = content,
                    IsChecked = id == lastPlace || (string.IsNullOrEmpty(lastPlace) && placeCards.Count == 0)
                };
                card.Checked += (_, _) =>
                {
                    foreach (var other in placeCards) if (!ReferenceEquals(other, card)) other.IsChecked = false;
                    _placeId = id;
                    _placeName = name;
                    _placeEmoji = emoji;
                    UpdateOutingFoot();
                };
                if (card.IsChecked == true)
                {
                    _placeId = id;
                    _placeName = name;
                    _placeEmoji = emoji;
                }
                placeCards.Add(card);
                placesWrap.Children.Add(card);
            }
        }
        body.Children.Add(placesWrap);
        _outingPreview = Txt("", 12, "Ink2", (FontFamily)FindResource("HandFont"), null, 3, 8, true);
        body.Children.Add(_outingPreview);

        body.Children.Add(Txt("去多久？", 9.5, "Muted", null, new FontFamily("Georgia"), 0, 7));
        var durations = new StackPanel { Orientation = System.Windows.Controls.Orientation.Horizontal };
        _duration10 = new ToggleButton { Content = "10 分钟", Style = (Style)FindResource("ChipToggle"), IsChecked = true };
        _duration30 = new ToggleButton { Content = "半小时", Style = (Style)FindResource("ChipToggle") };
        _duration10.Checked += (_, _) =>
        {
            _duration30!.IsChecked = false;
            _placeMinutes = 10;
            UpdateOutingFoot();
        };
        _duration30.Checked += (_, _) =>
        {
            _duration10!.IsChecked = false;
            _placeMinutes = 30;
            UpdateOutingFoot();
        };
        _duration10.Unchecked += (_, _) => { if (_duration30?.IsChecked != true) _duration10.IsChecked = true; };
        _duration30.Unchecked += (_, _) => { if (_duration10?.IsChecked != true) _duration30.IsChecked = true; };
        durations.Children.Add(_duration10);
        durations.Children.Add(_duration30);
        body.Children.Add(durations);
        body.Children.Add(Txt("回来心情会好一点，也会有一点疲惫。她不在的时候，时间也会自己走。", 10, "Muted", null, null, 0, 4, true));

        _outingFoot = new Button
        {
            Content = "让她出门",
            Style = (Style)FindResource("PrimaryButton"),
            IsEnabled = !string.IsNullOrEmpty(_placeId)
        };
        _outingFoot.Click += async (_, _) => await StartOutingAsync();
        UpdateOutingFoot();
        UpdateOutingPreview();
        OpenSheet("出门走走", "公园、游乐场，或者更远一点的地方", body, _outingFoot);
    }

    private void UpdateOutingPreview()
    {
        if (_outingPreview == null || string.IsNullOrEmpty(_placeId)) return;
        if (ContentData?["OUTINGS"] is JsonArray places)
        {
            foreach (JsonNode? place in places)
            {
                if (place != null && Str(place, "id") == _placeId)
                {
                    _outingPreview.Text = "“" + PickLines(place["preview"]) + "”";
                    break;
                }
            }
        }
    }

    private void UpdateOutingFoot()
    {
        if (_outingFoot == null) return;
        _outingFoot.IsEnabled = !string.IsNullOrEmpty(_placeId);
        _outingFoot.Content = string.IsNullOrEmpty(_placeId)
            ? "选一个地方"
            : $"去{_placeName} · {_placeMinutes} 分钟";
    }

    private async Task StartOutingAsync()
    {
        if (_busy || string.IsNullOrEmpty(_placeId)) return;
        _busy = true;
        try
        {
            JsonNode res = await _api.ActionAsync("outing_start", new()
            {
                ["placeId"] = _placeId,
                ["minutes"] = _placeMinutes
            });
            _api.State = res["state"];
            CloseSheet();
            RenderState();
            TonePlayer.Outing();
            ShowToast($"她去{_placeName}了，{_placeMinutes} 分钟后回来");
        }
        catch (ApiException ex)
        {
            CloseSheet();
            ShowToast(ex.Message == "already_away" ? "她已经出门啦" : ex.Message == "busy" ? "她正在运动，先让她动完吧" : "现在出不了门");
        }
        catch
        {
            SetOnline(false);
            ShowToast("连不上小屋，等会儿再试试");
        }
        finally
        {
            _busy = false;
        }
    }

    private void OpenExercise()
    {
        if (_isAway)
        {
            ShowToast("她还在外面，回来再运动吧");
            return;
        }
        if (State?["exercise"] != null)
        {
            ShowToast("她已经在运动啦");
            return;
        }
        TonePlayer.Open();
        JsonNode? last = State?["lastExercise"];
        string lastKind = last != null ? Str(last, "kindId") : "";
        _exerciseMinutes = 3;
        _exerciseKindId = "";
        _exerciseName = "";
        _exerciseEmoji = "🏃";

        var body = new StackPanel();
        body.Children.Add(Txt("运动时不能打扰她，但可以中断。健康值会大量增加，疲惫值也会——记得让她休息。", 10.5, "Muted", null, null, 0, 10, true));

        var wrap = new WrapPanel();
        var cards = new List<ToggleButton>();
        TextBlock? preview = null;
        Button? foot = null;

        void Refresh()
        {
            JsonNode? kind = null;
            if (ContentData?["EXERCISES"] is JsonArray items)
            {
                foreach (JsonNode? item in items)
                {
                    if (item != null && Str(item, "id") == _exerciseKindId) { kind = item; break; }
                }
            }
            if (preview != null)
            {
                preview.Text = kind == null ? "" : "“" + PickLines(kind["preview"]) + "”";
            }
            if (foot != null)
            {
                double fatigue = Num(State, "fatigue", 8);
                foot.IsEnabled = !string.IsNullOrEmpty(_exerciseKindId);
                foot.Content = string.IsNullOrEmpty(_exerciseKindId) ? "选一个运动" : $"让{_exerciseName} {_exerciseMinutes} 分钟";
                string warn = fatigue >= 70 ? " 她现在有点累，可能只能完成一部分。" : "";
                foot.ToolTip = kind?["durations"]?[_exerciseMinutes.ToString(CultureInfo.InvariantCulture)] is JsonNode plan
                    ? $"健康 +{Num(plan, "health"):0.#}，疲惫 +{Num(plan, "fatigue"):0.#}，心情 +{Num(plan, "mood"):0.#}。{warn}"
                    : null;
            }
        }

        if (ContentData?["EXERCISES"] is JsonArray kinds)
        {
            foreach (JsonNode? node in kinds)
            {
                if (node == null) continue;
                string id = Str(node, "id");
                string name = Str(node, "name");
                string emoji = Str(node, "emoji", "🏃");
                string blurb = Str(node, "blurb");
                var panel = new StackPanel();
                panel.Children.Add(Txt(emoji, 22, "Ink", (FontFamily)FindResource("EmojiFont")));
                panel.Children.Add(Txt(name, 13, "Ink", null, null, 0, 2));
                panel.Children.Add(Txt(blurb, 9.5, "Muted", null, null, 0, 0, true));
                var card = new ToggleButton
                {
                    Style = (Style)FindResource("PlaceToggle"),
                    Content = panel,
                    IsChecked = id == lastKind || (string.IsNullOrEmpty(lastKind) && cards.Count == 0)
                };
                card.Checked += (_, _) =>
                {
                    foreach (var other in cards) if (!ReferenceEquals(other, card)) other.IsChecked = false;
                    _exerciseKindId = id;
                    _exerciseName = name;
                    _exerciseEmoji = emoji;
                    Refresh();
                };
                if (card.IsChecked == true)
                {
                    _exerciseKindId = id;
                    _exerciseName = name;
                    _exerciseEmoji = emoji;
                }
                cards.Add(card);
                wrap.Children.Add(card);
            }
        }
        body.Children.Add(wrap);

        preview = Txt("", 12, "Ink2", (FontFamily)FindResource("HandFont"), null, 3, 8, true);
        body.Children.Add(preview);

        body.Children.Add(Txt("运动多久？", 9.5, "Muted", null, new FontFamily("Georgia"), 0, 7));
        var durations = new WrapPanel();
        var chips = new List<ToggleButton>();
        foreach (int m in new[] { 3, 5, 10, 30 })
        {
            var chip = new ToggleButton
            {
                Content = m == 30 ? "30 分钟 · 很久" : $"{m} 分钟",
                Style = (Style)FindResource("ChipToggle"),
                IsChecked = m == 3
            };
            chip.Checked += (_, _) =>
            {
                foreach (var other in chips) if (!ReferenceEquals(other, chip)) other.IsChecked = false;
                _exerciseMinutes = m;
                Refresh();
            };
            chips.Add(chip);
            durations.Children.Add(chip);
        }
        body.Children.Add(durations);
        body.Children.Add(Txt($"当前：健康 {Num(State, "health", 70):0} / 疲惫 {Num(State, "fatigue", 8):0}", 9.5, "Muted", null, null, 6, 0, true));

        foot = new Button { Content = "让她动一动", Style = (Style)FindResource("PrimaryButton") };
        foot.Click += async (_, _) => await StartExerciseAsync();
        Refresh();
        OpenSheet("运动一下", "跑步、跳绳、散步、拉伸，选一个", body, foot);
    }

    private async Task StartExerciseAsync()
    {
        if (_busy || string.IsNullOrEmpty(_exerciseKindId)) return;
        _busy = true;
        try
        {
            JsonNode res = await _api.ActionAsync("exercise_start", new()
            {
                ["kindId"] = _exerciseKindId,
                ["minutes"] = _exerciseMinutes
            });
            _api.State = res["state"];
            CloseSheet();
            HideBubble();
            RenderState();
            TonePlayer.Outing();
            ShowToast($"她开始{_exerciseName}了，{_exerciseMinutes} 分钟后结束");
        }
        catch (ApiException ex)
        {
            CloseSheet();
            if (ex.Message == "tired")
            {
                string line = ex.Body?["result"]?["line"]?.GetValue<string>() ?? "今天已经太累了，让我休息一会儿吧。";
                ShowBubble(line, 5200);
            }
            else if (ex.Message == "away") ShowToast("她还在外面呢");
            else ShowToast("现在还不方便运动");
        }
        catch
        {
            SetOnline(false);
            ShowToast("连不上小屋，等会儿再试试");
        }
        finally { _busy = false; }
    }

    /* --------------------------------------------------------------- profile */

    private void OpenProfile()
    {
        TonePlayer.Open();
        var body = new StackPanel();
        JsonNode? s = State;
        if (s == null) return;
        double mood = Num(s, "mood", 64);
        JsonNode? label = MoodLabelNode(mood);
        int days = DaysTogether(s);
        double todaySeconds = Num(s["daily"]?[Str(s, "today")], "activeSeconds", 0);

        // identity
        var identity = new Grid { Margin = new Thickness(0, 0, 0, 12) };
        identity.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(66) });
        identity.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        identity.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(76) });
        var avatar = new Image
        {
            Source = LoadBitmap("Assets/avatar-round.png"),
            Width = 62,
            Height = 62,
            Stretch = Stretch.UniformToFill,
            Clip = new EllipseGeometry(new Point(31, 31), 31, 31),
            VerticalAlignment = System.Windows.VerticalAlignment.Top
        };
        identity.Children.Add(avatar);
        var info = new StackPanel { Margin = new Thickness(10, 2, 10, 0) };
        info.Children.Add(Txt(Str(s, "name", "墨墨"), 25, "Ink", (FontFamily)FindResource("HandFont")));
        info.Children.Add(Txt($"第 {days} 天 · 心情 · {Str(label, "label")}", 10, "Muted", null, null, 0, 3));
        info.Children.Add(Txt(Str(label, "note"), 12, "Ink2", (FontFamily)FindResource("HandFont"), null, 0, 2, true));
        Grid.SetColumn(info, 1);
        identity.Children.Add(info);
        var dial = new Grid { Width = 72, Height = 72, VerticalAlignment = System.Windows.VerticalAlignment.Top };
        dial.Children.Add(new Border
        {
            CornerRadius = new CornerRadius(36),
            BorderBrush = (Brush)FindResource("BlushDeep"),
            BorderThickness = new Thickness(5)
        });
        var dialInner = new Border
        {
            Margin = new Thickness(7),
            CornerRadius = new CornerRadius(30),
            Background = (Brush)FindResource("Paper"),
            Child = new StackPanel
            {
                VerticalAlignment = System.Windows.VerticalAlignment.Center,
                Children =
                {
                    Txt(Str(label, "emoji", "🌤"), 14, "Ink", (FontFamily)FindResource("EmojiFont"), null, 0, 0, false, TextAlignment.Center),
                    Txt(Math.Round(mood).ToString(CultureInfo.InvariantCulture), 20, "Ink", new FontFamily("Georgia"), null, 0, 0, false, TextAlignment.Center),
                    Txt("心情", 7.5, "Muted", null, new FontFamily("Georgia"), 0, 0, false, TextAlignment.Center)
                }
            }
        };
        dial.Children.Add(dialInner);
        Grid.SetColumn(dial, 2);
        identity.Children.Add(dial);
        body.Children.Add(Card("", "", identity));

        // fullness
        double fullness = Num(s, "fullness", 0);
        var fullPanel = new StackPanel { Margin = new Thickness(0, 2, 0, 10) };
        var fullTop = new Grid();
        fullTop.Children.Add(Txt("饱食度", 9.5, "Muted"));
        var fullVal = Txt($"{Math.Round(fullness)}", 9.5, "Ink2", new FontFamily("Georgia"));
        fullVal.HorizontalAlignment = System.Windows.HorizontalAlignment.Right;
        fullTop.Children.Add(fullVal);
        fullPanel.Children.Add(fullTop);
        var bar = new ProgressBar
        {
            Value = Math.Clamp(fullness, 0, 100),
            Maximum = 100,
            Height = 7,
            Margin = new Thickness(0, 5, 0, 5),
            Background = (Brush)FindResource("Paper3"),
            Foreground = (Brush)FindResource("BlushDeep"),
            BorderThickness = new Thickness(0)
        };
        fullPanel.Children.Add(bar);
        fullPanel.Children.Add(Txt(FullnessNote(fullness), 10, "Muted"));
        body.Children.Add(fullPanel);

        // health + fatigue
        double health = Num(s, "health", 70);
        double fatigue = Num(s, "fatigue", 8);
        double finalHealth = health;
        body.Children.Add(MeterPanel("健康值", finalHealth, HealthNote(health), "SageDeep"));
        body.Children.Add(MeterPanel("疲惫值", fatigue, FatigueNote(fatigue), "Butter"));

        // stats
        var stats = new UniformGrid { Columns = 5, Margin = new Thickness(0, 0, 0, 12) };
        stats.Children.Add(Stat($"{todaySeconds / 60:0} 分钟", "今日陪伴"));
        stats.Children.Add(Stat(Num(s["totals"], "taps", 0).ToString("0"), "被戳"));
        stats.Children.Add(Stat(Num(s["totals"], "feeds", 0).ToString("0"), "投喂"));
        stats.Children.Add(Stat(Num(s["totals"], "outings", 0).ToString("0"), "出游"));
        stats.Children.Add(Stat(Num(s["totals"], "exercises", 0).ToString("0"), "运动"));
        body.Children.Add(Card("最近", "TOGETHER", stats));

        // chart
        var chart = BuildChart(s);
        body.Children.Add(Card("陪伴日历", "WEEK", chart));

        // outing log
        body.Children.Add(Card("出游手账", "TRIPS", BuildOutingLog(s)));

        // exercise log
        body.Children.Add(Card("运动记录", "SWEAT", BuildExerciseLog(s)));

        // feed log
        body.Children.Add(Card("最近吃了什么", "FEED", BuildFeedLog(s)));

        // account + sync
        body.Children.Add(Card("账号与同步", "SYNC", BuildPairPanel()));

        // settings
        body.Children.Add(Card("小屋设置", "SETTINGS", BuildSettings()));

        body.Children.Add(Txt("墨墨 v1.3 · 云同步 · 数据留在这台电脑上", 9, "Muted", null, null, 4, 8, false, TextAlignment.Center));

        OpenSheet("墨墨的手账", $"第 {days} 天 · 住在你的桌面上", body, null);
    }

    private Border Card(string title, string tag, UIElement content)
    {
        var border = new Border
        {
            Style = (Style)FindResource("Card"),
            Margin = new Thickness(0, 0, 0, 10)
        };
        var stack = new StackPanel();
        if (!string.IsNullOrEmpty(title))
        {
            var head = new Grid { Margin = new Thickness(0, 0, 0, 8) };
            head.Children.Add(Txt(title, 16, "Ink", (FontFamily)FindResource("HandFont")));
            var tagText = Txt(tag, 8, "Muted", null, new FontFamily("Georgia"));
            tagText.HorizontalAlignment = System.Windows.HorizontalAlignment.Right;
            head.Children.Add(tagText);
            stack.Children.Add(head);
        }
        stack.Children.Add(content);
        border.Child = stack;
        return border;
    }

    private UIElement MeterPanel(string label, double value, string note, string brushKey)
    {
        var panel = new StackPanel { Margin = new Thickness(0, 2, 0, 10) };
        var top = new Grid();
        top.Children.Add(Txt(label, 9.5, "Muted"));
        var val = Txt($"{Math.Round(value)}", 9.5, "Ink2", new FontFamily("Georgia"));
        val.HorizontalAlignment = System.Windows.HorizontalAlignment.Right;
        top.Children.Add(val);
        panel.Children.Add(top);
        panel.Children.Add(new ProgressBar
        {
            Value = Math.Clamp(value, 0, 100),
            Maximum = 100,
            Height = 7,
            Margin = new Thickness(0, 5, 0, 5),
            Background = (Brush)FindResource("Paper3"),
            Foreground = (Brush)FindResource(brushKey),
            BorderThickness = new Thickness(0)
        });
        panel.Children.Add(Txt(note, 10, "Muted"));
        return panel;
    }

    private static string HealthNote(double health) => health switch
    {
        >= 85 => "现在的她很有精神，跑起来像一阵风。",
        >= 60 => "健康值还不错，继续保持。",
        >= 35 => "有一点虚弱，吃点东西、慢慢运动会好起来。",
        _ => "要好好照顾她。先吃点东西，再慢慢恢复吧。"
    };

    private static string FatigueNote(double fatigue) => fatigue switch
    {
        >= 80 => "真的很累了。让她休息，不要再运动了。",
        >= 55 => "有点疲惫，休息一会儿会恢复得更好。",
        >= 25 => "微微喘，状态还算轻松。",
        _ => "精神很好，可以一起动一动。"
    };

    private UIElement BuildOutingLog(JsonNode s)
    {
        var stack = new StackPanel();
        int rows = 0;
        if (s["outing"] is JsonObject active)
        {
            long left = Math.Max(0, Long(active, "endsAt") - NowMs());
            var row = new Border
            {
                Background = (Brush)FindResource("Paper2"),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(9, 7, 9, 7),
                Margin = new Thickness(0, 0, 0, 7)
            };
            var g = new Grid();
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var t = new StackPanel();
            t.Children.Add(Txt($"{Str(active, "emoji", "🌳")} 正在{Str(active, "name", "公园")}", 11.5, "Ink"));
            t.Children.Add(Txt($"还有 {FormatClock(left)} 回来", 9.5, "Muted"));
            g.Children.Add(t);
            var plus = Txt($"+{Num(active, "moodPreview", 0):0.#}", 10, "BlushDeep", new FontFamily("Georgia"));
            plus.HorizontalAlignment = System.Windows.HorizontalAlignment.Right;
            Grid.SetColumn(plus, 1);
            g.Children.Add(plus);
            row.Child = g;
            stack.Children.Add(row);
            rows++;
        }
        if (s["outingHistory"] is JsonArray history)
        {
            foreach (JsonNode? item in history)
            {
                if (item == null || rows >= 5) break;
                var row = new Grid { Margin = new Thickness(0, 0, 0, 8) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(34) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                var badge = new Border
                {
                    Width = 30, Height = 30, CornerRadius = new CornerRadius(9),
                    Background = (Brush)FindResource("Paper2"),
                    Child = Txt(Str(item, "emoji", "🌿"), 15, "Ink", (FontFamily)FindResource("EmojiFont"))
                };
                row.Children.Add(badge);
                var texts = new StackPanel { Margin = new Thickness(8, 0, 0, 0) };
                texts.Children.Add(Txt(Str(item, "name", "出门走走"), 11.5, "Ink"));
                texts.Children.Add(Txt($"{RelativeTime(Str(item, "at"))} · {Num(item, "actualMinutes", Num(item, "minutes", 10)):0} 分钟"
                                        + (Bool(item, "cancelled") ? " · 刚出门就回来" : Bool(item, "early") ? " · 提前回来" : ""), 9.5, "Muted", null, null, 0, 1, true));
                string surprise = Str(item, "surprise");
                if (!string.IsNullOrWhiteSpace(surprise))
                {
                    texts.Children.Add(Txt("小惊喜：" + surprise, 9, "Muted", null, null, 0, 0, true));
                }
                Grid.SetColumn(texts, 1);
                row.Children.Add(texts);
                stack.Children.Add(row);
                rows++;
            }
        }
        if (rows == 0)
            stack.Children.Add(Txt("还没有出过门。\n去公园坐坐，或者去游乐场看一次摩天轮。", 10.5, "Muted", null, null, 10, 8, false, TextAlignment.Center));
        return stack;
    }

    private UIElement BuildExerciseLog(JsonNode s)
    {
        var stack = new StackPanel();
        int rows = 0;
        if (s["exercise"] is JsonObject active)
        {
            long left = Math.Max(0, Long(active, "endsAt") - NowMs());
            var row = new Border
            {
                Background = (Brush)FindResource("Paper2"),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(9, 7, 9, 7),
                Margin = new Thickness(0, 0, 0, 7)
            };
            var g = new Grid();
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var t = new StackPanel();
            t.Children.Add(Txt($"{Str(active, "emoji", "🏃")} 正在{Str(active, "name", "运动")}", 11.5, "Ink"));
            t.Children.Add(Txt($"还有 {FormatClock(left)} · 挥汗如雨", 9.5, "Muted"));
            g.Children.Add(t);
            var plus = Txt($"+{Num(active, "healthPreview", 0):0.#}", 10, "SageDeep", new FontFamily("Georgia"));
            plus.HorizontalAlignment = System.Windows.HorizontalAlignment.Right;
            Grid.SetColumn(plus, 1);
            g.Children.Add(plus);
            row.Child = g;
            stack.Children.Add(row);
            rows++;
        }
        if (s["exerciseHistory"] is JsonArray history)
        {
            foreach (JsonNode? item in history)
            {
                if (item == null || rows >= 5) break;
                string sub = $"{RelativeTime(Str(item, "at"))} · {Num(item, "actualMinutes", Num(item, "minutes", 3)):0} 分钟"
                             + (Bool(item, "early") ? " · 提前停下" : "")
                             + $" · 健康 +{Num(item, "healthDelta"):0.#} / 疲惫 +{Num(item, "fatigueDelta"):0.#}";
                var row = new Grid { Margin = new Thickness(0, 0, 0, 8) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(34) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                var badge = new Border
                {
                    Width = 30, Height = 30, CornerRadius = new CornerRadius(9),
                    Background = (Brush)FindResource("Paper2"),
                    Child = Txt(Str(item, "emoji", "🏃"), 15, "Ink", (FontFamily)FindResource("EmojiFont"))
                };
                row.Children.Add(badge);
                var texts = new StackPanel { Margin = new Thickness(8, 0, 0, 0) };
                texts.Children.Add(Txt(Str(item, "name", "运动"), 11.5, "Ink"));
                texts.Children.Add(Txt(sub, 9.5, "Muted", null, null, 0, 0, true));
                Grid.SetColumn(texts, 1);
                row.Children.Add(texts);
                stack.Children.Add(row);
                rows++;
            }
        }
        if (rows == 0)
            stack.Children.Add(Txt("还没有运动记录。\n跑步、跳绳、散步，或者只是拉伸五分钟。", 10.5, "Muted", null, null, 10, 8, false, TextAlignment.Center));
        return stack;
    }

    private UIElement BuildScenePicker(JsonNode s)
    {
        var wrap = new WrapPanel();
        string active = Str(s, "background", "home");
        var cards = new List<ToggleButton>();
        if (ContentData?["SCENES"] is JsonArray scenes)
        {
            foreach (JsonNode? scene in scenes)
            {
                if (scene == null) continue;
                string id = Str(scene, "id");
                string name = Str(scene, "name");
                string emoji = Str(scene, "emoji", "🏠");
                string subtitle = Str(scene, "subtitle");
                var panel = new StackPanel();
                panel.Children.Add(Txt(emoji, 22, "Ink", (FontFamily)FindResource("EmojiFont")));
                panel.Children.Add(Txt(name, 13, "Ink", null, null, 0, 2));
                panel.Children.Add(Txt(subtitle, 9, "Muted", null, null, 0, 0, true));
                var card = new ToggleButton
                {
                    Style = (Style)FindResource("PlaceToggle"),
                    Width = 136,
                    Margin = new Thickness(0, 0, 6, 6),
                    Content = panel,
                    IsChecked = id == active
                };
                card.Checked += async (_, _) =>
                {
                    foreach (var other in cards) if (!ReferenceEquals(other, card)) other.IsChecked = false;
                    if (id == Str(State, "background", "home")) return;
                    try
                    {
                        JsonNode res = await _api.ActionAsync("set_background", new() { ["background"] = id });
                        _api.State = res["state"];
                        RenderState();
                        ShowToast($"换成{name}了");
                    }
                    catch
                    {
                        ShowToast("现在换不了背景");
                    }
                };
                cards.Add(card);
                wrap.Children.Add(card);
            }
        }
        return wrap;
    }

    private UIElement BuildChart(JsonNode s)
    {
        var wrap = new StackPanel();
        var head = new Grid();
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var info = new StackPanel();
        var title = Txt("本周", 16, "Ink", (FontFamily)FindResource("HandFont"));
        var range = Txt("", 9, "Muted", null, new FontFamily("Georgia"));
        info.Children.Add(title);
        info.Children.Add(range);
        head.Children.Add(info);

        var prev = new Button { Content = "‹", Style = (Style)FindResource("SmallButton"), Width = 29, Padding = new Thickness(0), FontSize = 16, Margin = new Thickness(0, 0, 4, 0) };
        var next = new Button { Content = "›", Style = (Style)FindResource("SmallButton"), Width = 29, Padding = new Thickness(0), FontSize = 16, Margin = new Thickness(0, 0, 4, 0) };
        var cal = new Button { Content = "📅", Style = (Style)FindResource("SmallButton"), Width = 34, Padding = new Thickness(0), FontSize = 12 };
        Grid.SetColumn(prev, 1);
        Grid.SetColumn(next, 2);
        Grid.SetColumn(cal, 3);
        head.Children.Add(prev);
        head.Children.Add(next);
        head.Children.Add(cal);
        wrap.Children.Add(head);

        var chartHost = new StackPanel();
        wrap.Children.Add(chartHost);
        var note = Txt("", 9.5, "Muted", null, null, 3, 0);
        wrap.Children.Add(note);

        void Refresh()
        {
            DateTime monday = StartOfWeek(DateTime.Today).AddDays(_chartWeekOffset * 7);
            var values = new List<(DateTime Day, string Key, double Seconds, bool Today, bool Future)>();
            for (int i = 0; i < 7; i++)
            {
                DateTime d = monday.AddDays(i);
                string key = d.ToString("yyyy-MM-dd");
                JsonNode? row = s["daily"]?[key];
                values.Add((d, key, Num(row, "activeSeconds", 0), d.Date == DateTime.Today, d.Date > DateTime.Today));
            }
            double max = Math.Max(600, values.Max(v => v.Seconds));
            var bars = new StackPanel
            {
                Orientation = System.Windows.Controls.Orientation.Horizontal,
                Height = 96,
                VerticalAlignment = System.Windows.VerticalAlignment.Bottom,
                Margin = new Thickness(0, 6, 0, 0)
            };
            string[] labels = { "周一", "周二", "周三", "周四", "周五", "周六", "周日" };
            for (int i = 0; i < values.Count; i++)
            {
                var v = values[i];
                var col = new StackPanel { Width = 36, VerticalAlignment = System.Windows.VerticalAlignment.Bottom, Opacity = v.Future ? 0.36 : 1 };
                var track = new Grid { Height = 76, VerticalAlignment = System.Windows.VerticalAlignment.Bottom };
                double h = Math.Max(3, 72 * v.Seconds / max);
                var bar = new Border
                {
                    Height = h,
                    Width = 18,
                    CornerRadius = new CornerRadius(4, 4, 2, 2),
                    Background = v.Today ? (Brush)FindResource("Ink") : (Brush)FindResource("Blush"),
                    VerticalAlignment = System.Windows.VerticalAlignment.Bottom,
                    HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
                    ToolTip = $"{v.Key} · {v.Seconds / 60:0} 分钟"
                };
                track.Children.Add(bar);
                col.Children.Add(track);
                col.Children.Add(Txt(labels[i], 8, "Muted", null, null, 0, 4, false, TextAlignment.Center));
                bars.Children.Add(col);
            }
            chartHost.Children.Clear();
            chartHost.Children.Add(bars);
            title.Text = _chartWeekOffset == 0 ? "本周" : _chartWeekOffset == -1 ? "上周" : $"前 {-_chartWeekOffset} 周";
            range.Text = $"{monday:M/d} - {monday.AddDays(6):M/d} · 周一至周日";
            next.IsEnabled = _chartWeekOffset < 0;
            double total = values.Sum(v => v.Seconds) / 60;
            note.Text = total > 0 ? $"这一周陪了 {total:0} 分钟。" : "这一周还没有记录。";
        }

        prev.Click += (_, _) => { _chartWeekOffset--; Refresh(); };
        next.Click += (_, _) => { if (_chartWeekOffset < 0) { _chartWeekOffset++; Refresh(); } };
        cal.Click += (_, _) => OpenCalendar();
        Refresh();
        return wrap;
    }

    private static DateTime StartOfWeek(DateTime day)
    {
        int shift = ((int)day.DayOfWeek + 6) % 7;
        return day.Date.AddDays(-shift);
    }

    private void OpenCalendar(DateTime? month = null)
    {
        DateTime first = month ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
        first = new DateTime(first.Year, first.Month, 1);
        var panel = new StackPanel();
        var head = new Grid();
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var prev = new Button { Content = "‹", Style = (Style)FindResource("SmallButton"), Width = 30, Padding = new Thickness(0), FontSize = 16 };
        var next = new Button { Content = "›", Style = (Style)FindResource("SmallButton"), Width = 30, Padding = new Thickness(0), FontSize = 16 };
        var title = Txt($"{first.Year} 年 {first.Month} 月", 18, "Ink", (FontFamily)FindResource("HandFont"), null, 0, 0, false, TextAlignment.Center);
        Grid.SetColumn(prev, 0);
        Grid.SetColumn(title, 1);
        Grid.SetColumn(next, 2);
        head.Children.Add(prev);
        head.Children.Add(title);
        head.Children.Add(next);
        panel.Children.Add(head);

        var weekHead = new UniformGrid { Columns = 7, Margin = new Thickness(0, 10, 0, 3) };
        foreach (string w in new[] { "一", "二", "三", "四", "五", "六", "日" })
            weekHead.Children.Add(Txt(w, 8.5, "Muted", null, null, 0, 0, false, TextAlignment.Center));
        panel.Children.Add(weekHead);

        var grid = new UniformGrid { Columns = 7 };
        int blanks = (((int)first.DayOfWeek + 6) % 7);
        for (int i = 0; i < blanks; i++) grid.Children.Add(new Border());
        int days = DateTime.DaysInMonth(first.Year, first.Month);
        var detail = Txt("点一天，看看那天她陪了你多久。", 10, "Muted", null, null, 8, 0, true);
        for (int day = 1; day <= days; day++)
        {
            DateTime d = new DateTime(first.Year, first.Month, day);
            string key = d.ToString("yyyy-MM-dd");
            double seconds = Num(State?["daily"]?[key], "activeSeconds", 0);
            bool has = seconds > 0;
            var b = new Button
            {
                Content = day.ToString(),
                Height = 31,
                Margin = new Thickness(1),
                Padding = new Thickness(0),
                BorderThickness = new Thickness(d.Date == DateTime.Today ? 1.2 : 0),
                BorderBrush = (Brush)FindResource("Ink"),
                Background = has ? (Brush)FindResource("Paper2") : System.Windows.Media.Brushes.Transparent,
                Foreground = (Brush)FindResource("Ink"),
                FontSize = 10.5,
                ToolTip = has ? $"{seconds / 60:0} 分钟" : null
            };
            b.Click += (_, _) =>
            {
                detail.Text = has
                    ? $"{d:M 月 d 日} · 陪了 {seconds / 60:0} 分钟"
                    : $"{d:M 月 d 日} · 这天还没有记录。";
            };
            grid.Children.Add(b);
        }
        panel.Children.Add(grid);
        panel.Children.Add(detail);
        var close = new Button { Content = "收好", Style = (Style)FindResource("SmallButton"), HorizontalAlignment = System.Windows.HorizontalAlignment.Right, Margin = new Thickness(0, 12, 0, 0) };
        close.Click += (_, _) => HideModal();
        panel.Children.Add(close);
        prev.Click += (_, _) => OpenCalendar(first.AddMonths(-1));
        next.Click += (_, _) => OpenCalendar(first.AddMonths(1));
        ShowModal(panel);
    }

    private UIElement BuildFeedLog(JsonNode s)
    {
        var stack = new StackPanel();
        if (s["feedLog"] is not JsonArray log || log.Count == 0)
        {
            stack.Children.Add(Txt("还没有喂过东西。\n奶茶、炸串、可乐……她都在等。", 10.5, "Muted", null, null, 10, 8, false, TextAlignment.Center));
            return stack;
        }
        int count = 0;
        foreach (JsonNode? item in log)
        {
            if (item == null || count++ >= 5) break;
            var row = new Grid { Margin = new Thickness(0, 0, 0, 8) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(34) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var emoji = new Border
            {
                Width = 30, Height = 30, CornerRadius = new CornerRadius(9),
                Background = (Brush)FindResource("Paper2"),
                Child = Txt(Str(item, "emoji", "🍰"), 15, "Ink", (FontFamily)FindResource("EmojiFont"))
            };
            row.Children.Add(emoji);
            var texts = new StackPanel { Margin = new Thickness(8, 0, 0, 0) };
            string feedMeta = $"{Str(item, "itemName", "小零食")} · {Str(item, "optionLabel")}";
            if (Num(item, "healthDelta") > 0) feedMeta += $" · 健康 +{Num(item, "healthDelta"):0.#}";
            texts.Children.Add(Txt(feedMeta, 11, "Ink"));
            texts.Children.Add(Txt("“" + Str(item, "line") + "”", 10.5, "Ink2", (FontFamily)FindResource("HandFont"), null, 0, 0, true));
            Grid.SetColumn(texts, 1);
            row.Children.Add(texts);
            stack.Children.Add(row);
        }
        return stack;
    }

    private UIElement BuildPairPanel()
    {
        var stack = new StackPanel();
        stack.Children.Add(Txt("每个账号有独立的小屋。电脑和手机登录同一个账号，就会实时同步。", 10, "Muted", null, null, 0, 8, true));

        var accountRow = new Border
        {
            BorderBrush = (Brush)FindResource("LineStrong"),
            BorderThickness = new Thickness(1.5),
            CornerRadius = new CornerRadius(12),
            Padding = new Thickness(12, 8, 12, 8),
            Margin = new Thickness(0, 0, 0, 8)
        };
        var accountGrid = new Grid();
        accountGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        accountGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var accountTexts = new StackPanel();
        accountTexts.Children.Add(Txt("当前账号", 8.5, "Muted", null, new FontFamily("Georgia")));
        accountTexts.Children.Add(Txt(string.IsNullOrWhiteSpace(_api.AccountName) ? "已登录" : _api.AccountName, 22, "Ink", new FontFamily("Georgia")));
        var logout = new Button { Content = "退出账号", Style = (Style)FindResource("SmallButton") };
        logout.Click += async (_, _) =>
        {
            _settings.Token = "";
            _settings.Username = "";
            SaveSettings();
            try { await _api.LogoutAsync(); } catch { }
            CloseSheet();
            HideBubble();
            Hide();
            var auth = new AuthWindow(_api, _server);
            if (auth.ShowDialog() == true)
            {
                _settings.Token = _api.Token;
                _settings.Username = _api.AccountName;
                SaveSettings();
                _api.State = null;
                try { await _api.GetStateAsync(); } catch { }
                RenderState();
                Show();
                Activate();
            }
            else
            {
                System.Windows.Application.Current.Shutdown();
            }
        };
        accountGrid.Children.Add(accountTexts);
        Grid.SetColumn(logout, 1);
        accountGrid.Children.Add(logout);
        accountRow.Child = accountGrid;
        stack.Children.Add(accountRow);

        bool cloud = _server.CloudEnabled;
        var firstUrl = cloud ? "Supabase 云同步" : (_server.Urls.Count > 0 ? _server.Urls[0].Url : _server.BaseUrl);
        var linkRow = new Border
        {
            Background = (Brush)FindResource("Paper2"),
            CornerRadius = new CornerRadius(10),
            Padding = new Thickness(10, 7, 10, 7),
            Margin = new Thickness(0, 0, 0, 8)
        };
        var linkGrid = new Grid();
        linkGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        linkGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var link = Txt(cloud ? firstUrl : (firstUrl + "/").Replace("http://", ""), 10, "Ink2", new FontFamily("Georgia"));
        link.TextTrimming = TextTrimming.CharacterEllipsis;
        linkGrid.Children.Add(link);
        var copyLink = new Button { Content = cloud ? "云同步" : "复制地址", Style = (Style)FindResource("SmallButton") };
        copyLink.IsEnabled = !cloud;
        copyLink.Click += (_, _) => CopyText(firstUrl + "/", "地址已复制");
        Grid.SetColumn(copyLink, 1);
        linkGrid.Children.Add(copyLink);
        linkRow.Child = linkGrid;
        stack.Children.Add(linkRow);

        if (!cloud)
        {
            foreach (var (name, url) in _server.Urls)
            {
                var ip = new Grid { Margin = new Thickness(0, 1, 0, 1) };
                ip.Children.Add(Txt(name, 9.5, "Muted"));
                var ipText = Txt(url.Replace("http://", ""), 9.5, "Ink2", new FontFamily("Georgia"));
                ipText.HorizontalAlignment = System.Windows.HorizontalAlignment.Right;
                ip.Children.Add(ipText);
                stack.Children.Add(ip);
            }
            stack.Children.Add(Txt("手机和电脑连同一个 Wi-Fi，打开上面的地址，登录同一个账号和密码。账号之间的数据互相独立。", 9.5, "Muted", null, null, 0, 4, true));
        }
        else
        {
            stack.Children.Add(Txt("电脑和手机登录同一个账号即可同步，不需要同一 Wi-Fi，也不用填电脑地址。", 9.5, "Muted", null, null, 0, 4, true));
        }
        return stack;
    }

    private UIElement BuildSettings()
    {
        var stack = new StackPanel();
        stack.Children.Add(SwitchRow("声音", "很轻的提示音，不会吵", _settings.Sound, v =>
        {
            _settings.Sound = v;
            TonePlayer.Enabled = v;
            SaveSettings();
        }));
        stack.Children.Add(SwitchRow("始终置顶", "让她待在别的窗口上面", _settings.AlwaysOnTop, v =>
        {
            _settings.AlwaysOnTop = v;
            Topmost = v;
            SaveSettings();
        }));
        stack.Children.Add(SwitchRow("开机启动", "下次打开电脑，她已经在等你", _settings.AutoLaunch, v =>
        {
            _settings.AutoLaunch = v;
            SettingsStore.ApplyStartup(v);
            SaveSettings();
        }));
        var resetPos = new Button { Content = "回到右下角", Style = (Style)FindResource("GhostButton"), HorizontalAlignment = System.Windows.HorizontalAlignment.Left, Margin = new Thickness(0, 6, 0, 4) };
        resetPos.Click += (_, _) =>
        {
            var wa = SystemParameters.WorkArea;
            Left = wa.Right - Width - 20;
            Top = wa.Bottom - Height - 10;
            _settings.Left = Left;
            _settings.Top = Top;
            SaveSettings();
            ShowToast("回到右下角了");
        };
        stack.Children.Add(resetPos);
        var danger = new Border
        {
            Background = new SolidColorBrush(Color.FromArgb(20, 196, 103, 95)),
            CornerRadius = new CornerRadius(11),
            Padding = new Thickness(10),
            Margin = new Thickness(0, 6, 0, 0)
        };
        var dangerGrid = new Grid();
        dangerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        dangerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var dangerText = new StackPanel();
        dangerText.Children.Add(Txt("重新开始", 11.5, "Ink"));
        dangerText.Children.Add(Txt("清空心情、投喂、运动与出游记录，账号保留", 9, "Muted"));
        dangerGrid.Children.Add(dangerText);
        var reset = new Button { Content = "重置", Style = (Style)FindResource("DangerButton"), Padding = new Thickness(12, 5, 12, 5), FontSize = 10.5 };
        reset.Click += (_, _) => AskReset();
        Grid.SetColumn(reset, 1);
        dangerGrid.Children.Add(reset);
        danger.Child = dangerGrid;
        stack.Children.Add(danger);
        return stack;
    }

    private UIElement SwitchRow(string title, string note, bool value, Action<bool> changed)
    {
        var row = new Grid { Margin = new Thickness(0, 0, 0, 8) };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var texts = new StackPanel();
        texts.Children.Add(Txt(title, 11.5, "Ink"));
        texts.Children.Add(Txt(note, 9, "Muted"));
        row.Children.Add(texts);
        var sw = new CheckBox { Style = (Style)FindResource("Switch"), IsChecked = value, VerticalAlignment = System.Windows.VerticalAlignment.Center };
        sw.Checked += (_, _) => changed(true);
        sw.Unchecked += (_, _) => changed(false);
        Grid.SetColumn(sw, 1);
        row.Children.Add(sw);
        return row;
    }

    private void AskReset()
    {
        string created = Str(State, "createdAt");
        ShowConfirm("要重新开始吗？", "心情、饱食度、健康、投喂、运动、出游手账和陪伴时间都会清零。账号、名字和她本人会留下。", "清零", async () =>
        {
            try
            {
                JsonNode res = await _api.ActionAsync("reset", new() { ["confirm"] = created });
                _api.State = res["state"];
                RenderState();
                CloseSheet();
                ShowToast("小屋重新亮起来了");
            }
            catch { ShowToast("重置没有成功"); }
        });
    }

    private void SaveSettings() => SettingsStore.Save(_settings);

    private void CopyText(string text, string message)
    {
        try
        {
            System.Windows.Clipboard.SetText(text);
            ShowToast(message);
        }
        catch { ShowToast("复制失败"); }
    }

    private void StatRow(StackPanel parent, string value, string label)
    {
        var row = new Grid { Margin = new Thickness(0, 2, 0, 2) };
        row.Children.Add(Txt(label, 10.5, "Muted"));
        var v = Txt(value, 11, "Ink");
        v.HorizontalAlignment = System.Windows.HorizontalAlignment.Right;
        row.Children.Add(v);
        parent.Children.Add(row);
    }

    private UIElement Stat(string value, string label)
    {
        var s = new StackPanel { VerticalAlignment = System.Windows.VerticalAlignment.Center };
        s.Children.Add(Txt(value, 15, "Ink", new FontFamily("Georgia"), null, 0, 0, false, TextAlignment.Center));
        s.Children.Add(Txt(label, 8.5, "Muted", null, null, 0, 0, false, TextAlignment.Center));
        return s;
    }

    /* --------------------------------------------------------------- sheets */

    private void OpenSheet(string title, string sub, UIElement body, UIElement? foot)
    {
        HideBubble();
        Dock.Visibility = Visibility.Collapsed;
        SheetTitle.Text = title;
        SheetSub.Text = sub;
        SheetBody.Children.Clear();
        SheetBody.Children.Add(body);
        if (foot != null)
        {
            SheetFoot.Visibility = Visibility.Visible;
            SheetFootContent.Content = foot;
        }
        else
        {
            SheetFoot.Visibility = Visibility.Collapsed;
            SheetFootContent.Content = null;
        }
        SheetLayer.Visibility = Visibility.Visible;
        SheetLayer.Opacity = 0;
        SheetLayer.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(180)));
    }

    private void CloseSheet()
    {
        SheetLayer.Visibility = Visibility.Collapsed;
        SheetBody.Children.Clear();
        SheetFootContent.Content = null;
        UpdateDockVisibility();
    }

    private void UpdateDockVisibility()
    {
        bool show = !_isAway
                    && !_bubbleShowing
                    && ExerciseCard.Visibility != Visibility.Visible
                    && SheetLayer.Visibility != Visibility.Visible
                    && ModalLayer.Visibility != Visibility.Visible;
        Dock.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
    }

    private void ShowModal(UIElement content)
    {
        ModalContent.Content = content;
        ModalLayer.Visibility = Visibility.Visible;
        UpdateDockVisibility();
    }

    private void HideModal()
    {
        ModalLayer.Visibility = Visibility.Collapsed;
        ModalContent.Content = null;
        UpdateDockVisibility();
    }

    private void ShowConfirm(string title, string text, string ok, Action onOk)
    {
        var panel = new StackPanel();
        panel.Children.Add(Txt("MOMO", 8.5, "Muted", null, new FontFamily("Georgia")));
        panel.Children.Add(Txt(title, 21, "Ink", (FontFamily)FindResource("HandFont"), null, 0, 6));
        panel.Children.Add(Txt(text, 11.5, "Ink2", null, null, 0, 16, true));
        var buttons = new StackPanel { Orientation = System.Windows.Controls.Orientation.Horizontal, HorizontalAlignment = System.Windows.HorizontalAlignment.Right };
        var no = new Button { Content = "再想想", Style = (Style)FindResource("GhostButton"), Margin = new Thickness(0, 0, 8, 0) };
        no.Click += (_, _) => HideModal();
        var yes = new Button { Content = ok, Style = (Style)FindResource("PrimaryButton") };
        yes.Click += (_, _) =>
        {
            HideModal();
            onOk();
        };
        buttons.Children.Add(no);
        buttons.Children.Add(yes);
        panel.Children.Add(buttons);
        ShowModal(panel);
    }

    /* --------------------------------------------------------------- menu */

    private void OpenMenu()
    {
        var menu = new ContextMenu
        {
            PlacementTarget = this,
            Placement = PlacementMode.MousePoint
        };
        MenuItem Item(string header, Action action)
        {
            var item = new MenuItem { Header = header };
            item.Click += (_, _) => action();
            return item;
        }
        bool exercising = State?["exercise"] != null;
        if (exercising)
        {
            menu.Items.Add(Item("⏹  中断运动", AskStopExercise));
            menu.Items.Add(Item("💧  看看她", PeekExercise));
        }
        else
        {
            menu.Items.Add(Item("📔  个人页面", OpenProfile));
            menu.Items.Add(Item("🧋  喂她吃点", OpenFeed));
            menu.Items.Add(Item("🎒  出门走走", OpenOuting));
            menu.Items.Add(Item("🏃  运动一下", OpenExercise));
        }
        menu.Items.Add(Item("💬  和她说说话", () =>
        {
            if (State == null) return;
            if (State["exercise"] != null) PeekExercise();
            else ShowBubble(PickTapLine(), 5200);
        }));
        menu.Items.Add(new Separator());
        menu.Items.Add(Item(_settings.Sound ? "🔊  声音：开" : "🔇  声音：关", () =>
        {
            _settings.Sound = !_settings.Sound;
            TonePlayer.Enabled = _settings.Sound;
            SaveSettings();
            ShowToast(_settings.Sound ? "声音打开啦" : "安静下来了");
        }));
        menu.Items.Add(new Separator());
        menu.Items.Add(Item("—  藏起来", HidePet));
        menu.Items.Add(Item("×  退出", Quit));
        menu.IsOpen = true;
    }

    private void ScenePanel_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (ScenePanel.ActualWidth <= 0 || ScenePanel.ActualHeight <= 0) return;
        ScenePanel.Clip = new RectangleGeometry(
            new Rect(0, 0, ScenePanel.ActualWidth, ScenePanel.ActualHeight), 28, 28);
    }

    private void WindowDrag_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ButtonState != MouseButtonState.Pressed) return;
        try { DragMove(); } catch { }
    }

    private void SheetHeader_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ButtonState != MouseButtonState.Pressed) return;
        try
        {
            if (e.OriginalSource is DependencyObject source
                && FindVisualParent<System.Windows.Controls.Primitives.ButtonBase>(source) != null) return;
            DragMove();
        }
        catch { }
    }

    private static T? FindVisualParent<T>(DependencyObject? node) where T : DependencyObject
    {
        while (node != null)
        {
            if (node is T match) return match;
            node = node switch
            {
                ContentElement content => ContentOperations.GetParent(content)
                                          ?? (content as FrameworkContentElement)?.Parent,
                _ => System.Windows.Media.VisualTreeHelper.GetParent(node)
            };
        }
        return null;
    }

    private void OpenBackgroundSheet()
    {
        TonePlayer.Open();
        var body = new StackPanel();
        body.Children.Add(Txt("换一个她现在待着的地方。背景会跟着账号同步。", 10.5, "Muted", null, null, 0, 10, true));
        var wrap = new WrapPanel();
        string active = Str(State, "background", "home");
        var cards = new List<ToggleButton>();
        if (ContentData?["SCENES"] is JsonArray scenes)
        {
            foreach (JsonNode? scene in scenes)
            {
                if (scene == null) continue;
                string id = Str(scene, "id");
                string name = Str(scene, "name");
                string emoji = Str(scene, "emoji", "🏠");
                string subtitle = Str(scene, "subtitle");
                var content = new StackPanel();
                content.Children.Add(Txt(emoji, 24, "Ink", (FontFamily)FindResource("EmojiFont")));
                content.Children.Add(Txt(name, 13, "Ink", null, null, 0, 2));
                content.Children.Add(Txt(subtitle, 9.2, "Muted", null, null, 0, 0, true));
                var card = new ToggleButton
                {
                    Style = (Style)FindResource("PlaceToggle"),
                    Width = 140,
                    Content = content,
                    IsChecked = id == active
                };
                card.Checked += async (_, _) =>
                {
                    foreach (var other in cards) if (!ReferenceEquals(other, card)) other.IsChecked = false;
                    if (id == Str(State, "background", "home")) return;
                    try
                    {
                        JsonNode res = await _api.ActionAsync("set_background", new() { ["background"] = id });
                        _api.State = res["state"];
                        RenderState();
                        CloseSheet();
                        ShowToast($"换成{name}了");
                    }
                    catch
                    {
                        ShowToast("现在换不了背景");
                    }
                };
                cards.Add(card);
                wrap.Children.Add(card);
            }
        }
        body.Children.Add(wrap);
        OpenSheet("小屋背景", "她待着的地方", body, null);
    }

    private void HidePet()
    {
        Hide();
    }

    private void Quit()
    {
        _tray?.Dispose();
        System.Windows.Application.Current.Shutdown();
    }

    private void CreateTray()
    {
        try
        {
            string iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "app.ico");
            _tray = new WinForms.NotifyIcon
            {
                Icon = new Drawing.Icon(iconPath),
                Text = "墨墨 · 桌宠",
                Visible = true
            };
            var menu = new WinForms.ContextMenuStrip();
            menu.Items.Add("叫墨墨出来", null, (_, _) => ShowPet());
            menu.Items.Add("个人页面", null, (_, _) => OpenProfile());
            menu.Items.Add(new WinForms.ToolStripSeparator());
            menu.Items.Add("退出", null, (_, _) => Quit());
            _tray.ContextMenuStrip = menu;
            _tray.DoubleClick += (_, _) => ShowPet();
        }
        catch { }
    }

    private void ShowPet()
    {
        Show();
        Topmost = _settings.AlwaysOnTop;
        Activate();
    }

    /* --------------------------------------------------------------- smoke */

    private async Task RunSmokeAsync()
    {
        try
        {
            string outDir = Environment.GetEnvironmentVariable("MOMO_SMOKE_DIR") ?? Path.Combine(Environment.CurrentDirectory, "test", "shots");
            Directory.CreateDirectory(outDir);
            await Task.Delay(1100);
            SaveShot(outDir, "native-main.png");

            string hitPet = "?";
            string hitVoid = "?";
            try
            {
                var helper = new WindowInteropHelper(this);
                IntPtr hwnd = helper.Handle;
                Point petPt = PointToScreen(new Point(190, 430));
                Point voidPt = PointToScreen(new Point(6, 6));
                IntPtr lpPet = (IntPtr)(((int)petPt.Y << 16) | ((int)petPt.X & 0xFFFF));
                IntPtr lpVoid = (IntPtr)(((int)voidPt.Y << 16) | ((int)voidPt.X & 0xFFFF));
                hitPet = SendMessage(hwnd, 0x84, IntPtr.Zero, lpPet).ToString();
                hitVoid = SendMessage(hwnd, 0x84, IntPtr.Zero, lpVoid).ToString();
            }
            catch { }

            Tap();
            await Task.Delay(90);
            Tap();
            Tap();
            Tap();
            await Task.Delay(220);
            string spamText = BubbleText.Text;
            SaveShot(outDir, "native-spam.png");
            HideBubble();
            await Task.Delay(1200);
            ShowToast("测试提示 · 心情 +3");
            await Task.Delay(250);
            SaveShot(outDir, "native-toast.png");
            await Task.Delay(2300);

            OpenFeed();
            await Task.Delay(250);
            SaveShot(outDir, "native-feed.png");
            var feedToggles = FindVisuals<ToggleButton>(SheetBody).ToList();
            if (feedToggles.Count > 0)
            {
                feedToggles[0].IsChecked = true;
                await Task.Delay(150);
                var chips = FindVisuals<ToggleButton>(SheetBody).Where(t => !ReferenceEquals(t, feedToggles[0])).ToList();
                if (chips.Count > 1) chips[1].IsChecked = true;
                await Task.Delay(200);
                SaveShot(outDir, "native-feed-options.png");
            }
            CloseSheet();

            OpenOuting();
            await Task.Delay(250);
            SaveShot(outDir, "native-outing.png");
            CloseSheet();

            OpenExercise();
            await Task.Delay(250);
            SaveShot(outDir, "native-exercise.png");
            CloseSheet();

            OpenBackgroundSheet();
            await Task.Delay(300);
            SaveShot(outDir, "native-background.png");
            CloseSheet();

            OpenProfile();
            await Task.Delay(350);
            SaveShot(outDir, "native-profile.png");
            OpenCalendar();
            await Task.Delay(300);
            SaveShot(outDir, "native-calendar.png");
            HideModal();
            var profileScroll = FindVisuals<ScrollViewer>(SheetLayer).FirstOrDefault();
            if (profileScroll != null)
            {
                profileScroll.ScrollToVerticalOffset(320);
                await Task.Delay(300);
                SaveShot(outDir, "native-chart.png");
                profileScroll.ScrollToEnd();
                await Task.Delay(350);
                SaveShot(outDir, "native-profile-bottom.png");
            }
            CloseSheet();

            JsonNode feed = await _api.ActionAsync("feed", new()
            {
                ["itemId"] = "milk_tea",
                ["optionId"] = "sugar_5"
            });
            _api.State = feed["state"];
            RenderState();
            JsonNode? fr = feed["result"];
            if (fr != null) ShowBubble(Str(fr, "line", "好喝。"), 6000);
            SpawnFood("🧋");
            await Task.Delay(300);
            SaveShot(outDir, "native-fed.png");

            JsonNode exStart = await _api.ActionAsync("exercise_start", new() { ["kindId"] = "rope", ["minutes"] = 3 });
            _api.State = exStart["state"];
            RenderState();
            await Task.Delay(300);
            SaveShot(outDir, "native-exercising.png");
            bool exerciseHit = false;
            try
            {
                Point local = StopExerciseBtn.TranslatePoint(new Point(StopExerciseBtn.ActualWidth / 2, StopExerciseBtn.ActualHeight / 2), Root);
                exerciseHit = IsInteractive(local);
            }
            catch { }
            Tap();
            await Task.Delay(200);
            SaveShot(outDir, "native-exercise-peek.png");
            StopExerciseBtn.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
            await Task.Delay(900);
            SaveShot(outDir, "native-exercise-summary.png");
            bool stopped = State?["exercise"] == null;
            HideModal();
            if (!stopped) throw new Exception("exercise stop button did not stop the exercise");

            JsonNode outing = await _api.ActionAsync("outing_start", new() { ["placeId"] = "park", ["minutes"] = 10 });
            _api.State = outing["state"];
            RenderState();
            await Task.Delay(300);
            SaveShot(outDir, "native-away.png");

            await Task.Delay(1200);
            JsonNode finish = await _api.ActionAsync("outing_finish", new() { ["early"] = true });
            _api.State = finish["state"];
            RenderState();
            JsonNode? recap = finish["result"];
            if (recap != null && !Bool(recap, "cancelled")) ShowRecap(recap);
            else
            {
                JsonNode fake = JsonNode.Parse("{\"name\":\"公园\",\"emoji\":\"🌳\",\"at\":\"" + DateTime.Now.ToString("O") + "\",\"actualMinutes\":10,\"moodDelta\":10,\"fullnessDelta\":3,\"line\":\"在公园的长椅上坐了十分钟。风把落叶吹到脚边，我把它夹进书里了。\",\"souvenir\":\"🍂\",\"early\":false}")!;
                ShowRecap(fake);
            }
            await Task.Delay(400);
            SaveShot(outDir, "native-recap.png");

            var report = new JsonObject
            {
                ["ok"] = true,
                ["mood"] = Num(State, "mood", 0),
                ["fullness"] = Num(State, "fullness", 0),
                ["feeds"] = Num(State?["totals"], "feeds", 0),
                ["outings"] = Num(State?["totals"], "outings", 0),
                ["server"] = _server.BaseUrl,
                ["account"] = _api.AccountName,
                ["health"] = Num(State, "health", 0),
                ["fatigue"] = Num(State, "fatigue", 0)
            };
            report["spam"] = spamText;
            report["exerciseHit"] = exerciseHit;
            report["hitPet"] = hitPet;
            report["hitVoid"] = hitVoid;
            File.WriteAllText(Path.Combine(outDir, "native-smoke.json"), report.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            await Task.Delay(300);
            System.Windows.Application.Current.Shutdown();
        }
        catch (Exception ex)
        {
            try
            {
                File.WriteAllText(Path.Combine(Environment.CurrentDirectory, "test", "native-smoke-error.txt"), ex.ToString());
            }
            catch { }
            System.Windows.Application.Current.Shutdown(1);
        }
    }

    private void SaveShot(string dir, string file)
    {
        Root.UpdateLayout();
        var rtb = new RenderTargetBitmap((int)Width, (int)Height, 96, 96, PixelFormats.Pbgra32);
        rtb.Render(Root);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(rtb));
        using var stream = File.Create(Path.Combine(dir, file));
        encoder.Save(stream);
    }

    /* --------------------------------------------------------------- hit test */

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        var source = (HwndSource?)PresentationSource.FromVisual(this);
        source?.AddHook(WndProc);
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        const int WM_NCHITTEST = 0x84;
        if (msg == WM_NCHITTEST)
        {
            long lp = lParam.ToInt64();
            int sx = unchecked((short)(lp & 0xFFFF));
            int sy = unchecked((short)((lp >> 16) & 0xFFFF));
            System.Windows.Point p = PointFromScreen(new System.Windows.Point(sx, sy));
            if (!IsInteractive(p))
            {
                handled = true;
                return new IntPtr(-1); // HTTRANSPARENT
            }
        }
        return IntPtr.Zero;
    }

    private bool IsInteractive(System.Windows.Point p)
    {
        if (SheetLayer.Visibility == Visibility.Visible || ModalLayer.Visibility == Visibility.Visible) return true;
        if (BubbleWrap.Visibility == Visibility.Visible && BoundsOf(BubbleWrap).Contains(p)) return true;
        if (BoundsOf(BackgroundBtn).Contains(p)) return true;
        if (Dock.Visibility == Visibility.Visible && BoundsOf(Dock).Contains(p)) return true;
        if (BoundsOf(MoodPill).Contains(p)) return true;
        if (AwayCard.Visibility == Visibility.Visible && BoundsOf(AwayCard).Contains(p)) return true;
        if (ExerciseCard.Visibility == Visibility.Visible && BoundsOf(ExerciseCard).Contains(p)) return true;
        if (ScenePanel.Visibility == Visibility.Visible && BoundsOf(ScenePanel).Contains(p)) return true;
        if (Pet.Visibility != Visibility.Visible) return false;
        return PetAlphaAt(p);
    }

    private Rect BoundsOf(FrameworkElement el)
    {
        if (el.ActualWidth <= 0 || el.ActualHeight <= 0) return Rect.Empty;
        try
        {
            return el.TransformToAncestor(Root).TransformBounds(new Rect(0, 0, el.ActualWidth, el.ActualHeight));
        }
        catch
        {
            return Rect.Empty;
        }
    }

    private bool PetAlphaAt(System.Windows.Point p)
    {
        if (_petMask == null || Pet.ActualWidth <= 0) return BoundsOf(Pet).Contains(p);
        try
        {
            GeneralTransform inv = Pet.TransformToAncestor(Root).Inverse;
            System.Windows.Point local;
            try { local = inv.Transform(p); }
            catch { return true; }
            if (local.X < 0 || local.Y < 0 || local.X >= Pet.ActualWidth || local.Y >= Pet.ActualHeight) return false;
            int x = (int)(local.X / Pet.ActualWidth * MaskSize);
            int y = (int)(local.Y / Pet.ActualHeight * MaskSize);
            for (int dy = -1; dy <= 1; dy++)
            {
                for (int dx = -1; dx <= 1; dx++)
                {
                    int px = Math.Clamp(x + dx, 0, MaskSize - 1);
                    int py = Math.Clamp(y + dy, 0, MaskSize - 1);
                    if (_petMask[(py * MaskSize + px) * 4 + 3] > 18) return true;
                }
            }
            return false;
        }
        catch
        {
            return true;
        }
    }

    private void BuildPetMask()
    {
        try
        {
            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.UriSource = new Uri(Path.Combine(AppContext.BaseDirectory, "Assets", "pet.png"), UriKind.Absolute);
            bmp.DecodePixelWidth = MaskSize;
            bmp.CacheOption = BitmapCacheOption.OnLoad;
            bmp.EndInit();
            var fmt = new FormatConvertedBitmap(bmp, PixelFormats.Bgra32, null, 0);
            int stride = MaskSize * 4;
            var data = new byte[stride * MaskSize];
            fmt.CopyPixels(data, stride, 0);
            _petMask = data;
        }
        catch { _petMask = null; }
    }

    private static IEnumerable<T> FindVisuals<T>(DependencyObject root) where T : DependencyObject
    {
        for (int i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
        {
            DependencyObject child = VisualTreeHelper.GetChild(root, i);
            if (child is T match) yield return match;
            foreach (T nested in FindVisuals<T>(child)) yield return nested;
        }
    }

    /* --------------------------------------------------------------- helpers */

    private JsonNode? MoodLabelNode(double mood)
    {
        if (ContentData?["MOOD_LABELS"] is JsonArray arr)
        {
            foreach (JsonNode? item in arr)
            {
                if (item != null && mood >= Num(item, "min", 0)) return item;
            }
        }
        return null;
    }

    private static string FullnessNote(double v) => v >= 90 ? "真的吃不下了，再喂也只能看着。"
        : v >= 70 ? "有点饱，但还可以再吃一小口。"
        : v >= 40 ? "肚子刚刚好，心情也刚刚好。"
        : "肚子空空的，正好可以吃点东西。";

    private int DaysTogether(JsonNode s)
    {
        DateTime created = ParseTime(Str(s, "createdAt", ""));
        if (created == DateTime.MinValue) return 1;
        return Math.Max(1, (DateTime.Now.Date - created.Date).Days + 1);
    }

    private static string FormatClock(long ms)
    {
        long total = Math.Max(0, (ms + 999) / 1000);
        long h = total / 3600;
        long m = total % 3600 / 60;
        long sec = total % 60;
        return h > 0 ? $"{h}:{m:00}:{sec:00}" : $"{m:00}:{sec:00}";
    }

    private static string RelativeTime(string iso)
    {
        if (!DateTimeOffset.TryParse(iso, out var dt)) return "";
        var span = DateTimeOffset.Now - dt;
        if (span.TotalMinutes < 1) return "刚刚";
        if (span.TotalMinutes < 60) return $"{(int)span.TotalMinutes} 分钟前";
        if (span.TotalHours < 24) return $"{(int)span.TotalHours} 小时前";
        return dt.LocalDateTime.ToString("M/d");
    }

    private static string FormatDate(string iso)
    {
        DateTime dt = ParseTime(iso);
        return dt == DateTime.MinValue ? "" : $"{dt.Month} 月 {dt.Day} 日 {Weekday(dt)}";
    }

    private static string Weekday(DateTime d) => "周" + "日一二三四五六"[(int)d.DayOfWeek];

    private static DateTime ParseTime(string iso)
    {
        if (string.IsNullOrWhiteSpace(iso)) return DateTime.MinValue;
        if (DateTime.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out DateTime dt)) return dt.ToLocalTime();
        return DateTime.MinValue;
    }

    private static string Str(JsonNode? node, string key, string def = "")
    {
        try { return node?[key]?.GetValue<string>() ?? def; } catch { return def; }
    }

    private static double Num(JsonNode? node, string key, double def = 0)
    {
        try { return node?[key]?.GetValue<double>() ?? def; } catch { return def; }
    }

    private static long Long(JsonNode? node, string key, long def = 0)
    {
        try { return node?[key]?.GetValue<long>() ?? def; } catch { return def; }
    }

    private static bool Bool(JsonNode? node, string key)
    {
        try { return node?[key]?.GetValue<bool>() ?? false; } catch { return false; }
    }

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private TextBlock Txt(string text, double size, string brush, FontFamily? font = null, FontFamily? altFont = null,
        double top = 0, double bottom = 0, bool wrap = false, TextAlignment align = TextAlignment.Left)
    {
        var t = new TextBlock
        {
            Text = text,
            FontSize = size,
            Foreground = (Brush)FindResource(brush),
            FontFamily = font ?? (FontFamily)FindResource("UiFont"),
            TextWrapping = wrap ? TextWrapping.Wrap : TextWrapping.NoWrap,
            TextAlignment = align,
            Margin = new Thickness(0, top, 0, bottom)
        };
        if (altFont != null) t.FontFamily = altFont;
        return t;
    }

    private Border Chip(string text)
    {
        return new Border
        {
            Background = (Brush)FindResource("Paper2"),
            CornerRadius = new CornerRadius(10),
            Padding = new Thickness(8, 4, 8, 4),
            Margin = new Thickness(0, 0, 6, 0),
            Child = new TextBlock
            {
                Text = text,
                FontSize = 9.5,
                Foreground = (Brush)FindResource("Ink2")
            }
        };
    }

    private static BitmapImage LoadBitmap(string relative)
    {
        var bmp = new BitmapImage();
        bmp.BeginInit();
        bmp.UriSource = new Uri(Path.Combine(AppContext.BaseDirectory, relative), UriKind.Absolute);
        bmp.CacheOption = BitmapCacheOption.OnLoad;
        bmp.EndInit();
        bmp.Freeze();
        return bmp;
    }

    private void FirstTip()
    {
        if (_firstTipShown || State == null) return;
        _firstTipShown = true;
        if (Num(State?["totals"], "taps", 0) == 0 && Num(State?["totals"], "feeds", 0) == 0 && BubbleWrap.Visibility != Visibility.Visible)
        {
            ShowBubble("右键我，可以打开个人页面。……先记住这句。", 6500);
        }
    }
}
