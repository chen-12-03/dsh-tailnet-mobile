package com.chen1.dshmobile;

import android.content.Context;
import android.content.SharedPreferences;

final class AppConfig {
    static final String DEFAULT_HOST = "";
    static final int DEFAULT_PORT = 22;
    static final String DEFAULT_USER = "";
    static final String TASK_NAME = "DSH Web";
    static final String DEFAULT_TAILNET_BASE_URL = "";

    final String host;
    final int port;
    final String username;
    final String tailnetBaseUrl;

    AppConfig(String host, int port, String username, String tailnetBaseUrl) {
        this.host = host;
        this.port = port;
        this.username = username;
        this.tailnetBaseUrl = normalizeBaseUrl(tailnetBaseUrl);
    }

    static AppConfig load(Context context) {
        SharedPreferences prefs = context.getSharedPreferences("connection", Context.MODE_PRIVATE);
        return new AppConfig(
                prefs.getString("host", DEFAULT_HOST),
                prefs.getInt("port", DEFAULT_PORT),
                prefs.getString("username", DEFAULT_USER),
                prefs.getString("tailnetBaseUrl", DEFAULT_TAILNET_BASE_URL));
    }

    void save(Context context) {
        context.getSharedPreferences("connection", Context.MODE_PRIVATE)
                .edit()
                .putString("host", host)
                .putInt("port", port)
                .putString("username", username)
                .putString("tailnetBaseUrl", tailnetBaseUrl)
                .apply();
    }

    String hostId() {
        return host + ":" + port;
    }

    String mobileUrl() {
        return tailnetBaseUrl + "/m";
    }

    String desktopUrl() {
        return tailnetBaseUrl + "/";
    }

    private static String normalizeBaseUrl(String value) {
        String result = value == null ? "" : value.trim();
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        return result;
    }
}
