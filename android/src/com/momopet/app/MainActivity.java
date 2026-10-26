package com.momopet.app;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * A deliberately tiny WebView shell for the Momo PWA.
 *
 * The Windows app hosts the account server on the local network. On first
 * launch the user enters the LAN address shown in 墨墨 → 个人页面 → 账号与同步.
 * The address is remembered, and the page itself keeps the account session.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "momo";
    private static final String KEY_SERVER = "server";

    private SharedPreferences prefs;
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String saved = prefs.getString(KEY_SERVER, "");
        if (saved == null || saved.trim().isEmpty()) {
            showSetup("在电脑上打开墨墨 → 个人页面 → 账号与同步，把地址填在这里。");
        } else {
            loadPet(saved);
        }
    }

    private void showSetup(String message) {
        if (web != null) {
            web.stopLoading();
            web.destroy();
            web = null;
        }

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(52, 92, 52, 40);
        box.setBackgroundColor(Color.rgb(251, 246, 238));

        TextView title = new TextView(this);
        title.setText("连接墨墨的小屋");
        title.setTextSize(28);
        title.setTextColor(Color.rgb(33, 30, 38));
        title.setGravity(Gravity.CENTER);
        box.addView(title);

        TextView note = new TextView(this);
        note.setText(message + "\n\n手机和电脑要连同一个 Wi-Fi。");
        note.setTextSize(14);
        note.setTextColor(Color.rgb(122, 111, 101));
        note.setGravity(Gravity.CENTER);
        note.setPadding(0, 18, 0, 30);
        box.addView(note);

        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setText(prefs.getString(KEY_SERVER, "http://192.168.1.8:8787"));
        input.setHint("http://电脑IP:8787");
        input.setTextSize(16);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        box.addView(input, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        Button connect = new Button(this);
        connect.setText("连接");
        connect.setTextSize(16);
        connect.setOnClickListener(v -> {
            String url = normalize(input.getText().toString());
            if (url.isEmpty()) {
                Toast.makeText(this, "请填写电脑地址", Toast.LENGTH_SHORT).show();
                return;
            }
            prefs.edit().putString(KEY_SERVER, url).apply();
            loadPet(url);
        });
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        buttonParams.topMargin = 22;
        box.addView(connect, buttonParams);

        TextView help = new TextView(this);
        help.setText("地址示例：http://192.168.1.8:8787\n电脑关掉后手机就连不上；重新打开电脑上的墨墨即可。");
        help.setTextSize(12);
        help.setTextColor(Color.rgb(145, 132, 120));
        help.setGravity(Gravity.CENTER);
        help.setPadding(0, 24, 0, 0);
        box.addView(help);

        setContentView(box);
    }

    private String normalize(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (s.isEmpty()) return "";
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://" + s;
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    private void loadPet(String url) {
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.rgb(251, 246, 238));

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        web.loadUrl(url);
        frame.addView(web, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        Button gear = new Button(this);
        gear.setText("⚙");
        gear.setTextSize(18);
        gear.setAlpha(0.82f);
        gear.setOnClickListener(v -> showSetup("要换一台电脑？修改地址后会重新连接。"));
        FrameLayout.LayoutParams gearParams = new FrameLayout.LayoutParams(96, 96);
        gearParams.gravity = Gravity.TOP | Gravity.END;
        gearParams.topMargin = 18;
        gearParams.rightMargin = 18;
        frame.addView(gear, gearParams);

        setContentView(frame);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
