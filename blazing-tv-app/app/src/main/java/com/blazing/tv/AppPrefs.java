package com.blazing.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

/** 应用设置：MoonTV 服务器地址（默认 BuildConfig.DEFAULT_SERVER）和界面大小。 */
final class AppPrefs {
    private static final String FILE = "blazing_tv";
    private static final String KEY_SERVER = "server_url";
    private static final String KEY_UI_SCALE = "ui_scale_percent";

    /** 可选的界面大小（百分比），100 = 网页原始排版。 */
    static final int[] UI_SCALE_OPTIONS = {100, 90, 80, 70};
    static final int DEFAULT_UI_SCALE = 100;

    private final SharedPreferences prefs;

    AppPrefs(Context context) {
        prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    String getServer() {
        return prefs.getString(KEY_SERVER, BuildConfig.DEFAULT_SERVER);
    }

    void setServer(String url) {
        prefs.edit().putString(KEY_SERVER, url).apply();
    }

    int getUiScale() {
        return clampUiScale(prefs.getInt(KEY_UI_SCALE, DEFAULT_UI_SCALE));
    }

    void setUiScale(int percent) {
        prefs.edit().putInt(KEY_UI_SCALE, clampUiScale(percent)).apply();
    }

    /** 只接受预设档位，其他值回落到默认，避免排版被设成极端尺寸。 */
    static int clampUiScale(int percent) {
        for (int option : UI_SCALE_OPTIONS) {
            if (option == percent) return percent;
        }
        return DEFAULT_UI_SCALE;
    }

    /** 规范化并校验地址；不合法返回 null。 */
    static String normalize(String raw) {
        if (raw == null) return null;
        String url = raw.trim();
        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        boolean isHttp = "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
        if (!isHttp || uri.getHost() == null || uri.getHost().isEmpty()) return null;
        return url;
    }
}
