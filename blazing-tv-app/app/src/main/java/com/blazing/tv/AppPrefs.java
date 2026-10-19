package com.blazing.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

/** 保存 MoonTV 服务器地址，默认值来自 BuildConfig.DEFAULT_SERVER。 */
final class ServerPrefs {
    private static final String FILE = "blazing_tv";
    private static final String KEY_SERVER = "server_url";

    private final SharedPreferences prefs;

    ServerPrefs(Context context) {
        prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    String getServer() {
        return prefs.getString(KEY_SERVER, BuildConfig.DEFAULT_SERVER);
    }

    void setServer(String url) {
        prefs.edit().putString(KEY_SERVER, url).apply();
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
