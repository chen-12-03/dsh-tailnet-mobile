package com.chen1.dshmobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MainActivity extends Activity {
    private static final long AUTO_LOCK_MS = TimeUnit.MINUTES.toMillis(15);
    private static final String TAILSCALE_PACKAGE = "com.tailscale.ipn";
    private static final String TAILSCALE_RECEIVER = "com.tailscale.ipn.IPNReceiver";
    private static final String TAILSCALE_CONNECT_ACTION = "com.tailscale.ipn.CONNECT_VPN";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService sshExecutor = Executors.newSingleThreadExecutor();
    private final Object passwordLock = new Object();

    private EditText hostInput;
    private EditText portInput;
    private EditText userInput;
    private EditText tailnetBaseInput;
    private EditText passwordInput;
    private Button unlockButton;
    private Button lockButton;
    private Button startButton;
    private Button statusButton;
    private Button stopButton;
    private TextView vpnStatus;
    private TextView dshStatus;
    private TextView resultLog;
    private TextView mobileUrlText;
    private TextView desktopUrlText;

    private SshController sshController;
    private char[] cachedPassword;
    private AppConfig activeConfig;
    private boolean commandRunning;
    private boolean tailscaleRequestRunning;

    private final Runnable autoLock = () -> {
        if (hasCachedPassword()) {
            lockAndClearPassword("已因 15 分钟未操作而自动锁定。", true);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        setContentView(R.layout.activity_main);

        bindViews();
        populateSavedConfig();
        sshController = new SshController(this, this::confirmHostKey);
        wireActions();
        setUnlockedUi(false);
        refreshVpnStatus();
        mainHandler.postDelayed(() -> requestTailscaleConnection(true), 350);
    }

    @Override
    protected void onResume() {
        super.onResume();
        mainHandler.postDelayed(this::refreshVpnStatus, 400);
    }

    @Override
    public void onUserInteraction() {
        super.onUserInteraction();
        if (hasCachedPassword()) scheduleAutoLock();
    }

    @Override
    protected void onDestroy() {
        mainHandler.removeCallbacks(autoLock);
        clearCachedPassword();
        passwordInput.getText().clear();
        sshExecutor.shutdownNow();
        super.onDestroy();
    }

    private void bindViews() {
        hostInput = findViewById(R.id.hostInput);
        portInput = findViewById(R.id.portInput);
        userInput = findViewById(R.id.userInput);
        tailnetBaseInput = findViewById(R.id.tailnetBaseInput);
        passwordInput = findViewById(R.id.passwordInput);
        unlockButton = findViewById(R.id.unlockButton);
        lockButton = findViewById(R.id.lockButton);
        startButton = findViewById(R.id.startButton);
        statusButton = findViewById(R.id.statusButton);
        stopButton = findViewById(R.id.stopButton);
        vpnStatus = findViewById(R.id.vpnStatus);
        dshStatus = findViewById(R.id.dshStatus);
        resultLog = findViewById(R.id.resultLog);
        mobileUrlText = findViewById(R.id.mobileUrlText);
        desktopUrlText = findViewById(R.id.desktopUrlText);

        passwordInput.setSaveEnabled(false);
        passwordInput.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
    }

    private void populateSavedConfig() {
        AppConfig config = AppConfig.load(this);
        hostInput.setText(config.host);
        portInput.setText(String.valueOf(config.port));
        userInput.setText(config.username);
        tailnetBaseInput.setText(config.tailnetBaseUrl);
        refreshModeUi(config);
    }

    private void wireActions() {
        unlockButton.setOnClickListener(v -> unlock());
        lockButton.setOnClickListener(v -> lockAndClearPassword("已锁定，内存中的密码已清除。", true));
        startButton.setOnClickListener(v -> runDshCommand("正在启动 DSH Web…", SshController::start));
        statusButton.setOnClickListener(v -> runDshCommand("正在查询状态…", SshController::status));
        stopButton.setOnClickListener(v -> runDshCommand("正在停止 DSH Web…", SshController::stop));
        findViewById(R.id.tailscaleButton).setOnClickListener(v -> requestTailscaleConnection(true));

        findViewById(R.id.mobileWebButton).setOnClickListener(v -> {
            AppConfig config = readConfig();
            if (config != null) openUrl(config.mobileUrl());
        });
        findViewById(R.id.desktopWebButton).setOnClickListener(v -> {
            AppConfig config = readConfig();
            if (config != null) openUrl(config.desktopUrl());
        });
        findViewById(R.id.copyLinksButton).setOnClickListener(v -> copyLinks());
        findViewById(R.id.resetHostKeyButton).setOnClickListener(v -> confirmResetHostKey());
    }

    private void unlock() {
        if (commandRunning) return;
        AppConfig config = readConfig();
        if (config == null) return;

        char[] candidate = readPassword();
        if (candidate.length == 0) {
            passwordInput.setError("请输入 Windows SSH 密码");
            return;
        }

        setBusy(true);
        resultLog.setText("正在验证 SSH 连接…\n首次连接会要求核对电脑的 SSH 主机指纹。");
        sshExecutor.execute(() -> {
            try {
                SshController.Result result = sshController.probe(config, candidate);
                if (result.exitCode != 0 || !result.contains("DSH_MOBILE_AUTH_OK")) {
                    throw new IllegalStateException("电脑未返回预期的验证结果。" + combineOutput(result));
                }
                synchronized (passwordLock) {
                    clearCachedPasswordLocked();
                    cachedPassword = Arrays.copyOf(candidate, candidate.length);
                    activeConfig = config;
                }
                config.save(this);
                runOnUiThread(() -> {
                    passwordInput.getText().clear();
                    setBusy(false);
                    setUnlockedUi(true);
                    dshStatus.setText("SSH 已连接");
                    resultLog.setText("连接成功。密码仅保存在本次 App 进程的内存中。\n现在可以启动、查询或停止 DSH Web。");
                    scheduleAutoLock();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    setBusy(false);
                    setUnlockedUi(false);
                    resultLog.setText(friendlyError(error));
                });
            } finally {
                Arrays.fill(candidate, '\0');
            }
        });
    }

    private void runDshCommand(String progress, Command command) {
        AppConfig config;
        char[] password;
        synchronized (passwordLock) {
            if (cachedPassword == null || activeConfig == null) {
                lockAndClearPassword("会话已锁定，请重新输入密码。", true);
                return;
            }
            password = Arrays.copyOf(cachedPassword, cachedPassword.length);
            config = activeConfig;
        }

        scheduleAutoLock();
        setBusy(true);
        resultLog.setText(progress);
        sshExecutor.execute(() -> {
            try {
                SshController.Result result = command.run(sshController, config, password);
                String display = combineOutput(result);
                runOnUiThread(() -> {
                    setBusy(false);
                    applyStatusFrom(result);
                    resultLog.setText(display.isEmpty() ? "操作完成。" : display);
                    scheduleAutoLock();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    setBusy(false);
                    resultLog.setText(friendlyError(error));
                });
            } finally {
                Arrays.fill(password, '\0');
            }
        });
    }

    private void applyStatusFrom(SshController.Result result) {
        if (result.contains("STILL_RUNNING")) {
            dshStatus.setText("停止失败：3080 端口仍在运行");
            dshStatus.setTextColor(Color.rgb(180, 35, 35));
        } else if (result.contains("RUNNING")) {
            dshStatus.setText("运行中 · 端口 3080");
            dshStatus.setTextColor(Color.rgb(22, 125, 75));
        } else if (result.contains("STOPPED")) {
            dshStatus.setText("已停止");
            dshStatus.setTextColor(Color.rgb(91, 101, 116));
        } else if (result.contains("START_REQUESTED")) {
            dshStatus.setText("已发出启动请求，尚未检测到端口");
            dshStatus.setTextColor(Color.rgb(186, 108, 0));
        }
    }

    private AppConfig readConfig() {
        String host = hostInput.getText().toString().trim();
        String user = userInput.getText().toString().trim();
        if (TextUtils.isEmpty(host)) {
            hostInput.setError("请输入电脑的 Tailscale IP");
            return null;
        }
        if (TextUtils.isEmpty(user)) {
            userInput.setError("请输入 Windows 用户名");
            return null;
        }
        int port;
        try {
            port = Integer.parseInt(portInput.getText().toString().trim());
            if (port < 1 || port > 65535) throw new NumberFormatException();
        } catch (NumberFormatException error) {
            portInput.setError("端口应为 1–65535");
            return null;
        }
        String baseUrl = normalizeTailnetBaseInput(tailnetBaseInput.getText().toString());
        if (TextUtils.isEmpty(baseUrl)) {
            tailnetBaseInput.setError("请输入 HTTPS Tailscale Serve 根地址，例如 https://电脑名.tailnet名.ts.net");
            return null;
        }
        if (!TextUtils.isEmpty(baseUrl)) tailnetBaseInput.setText(baseUrl);
        return new AppConfig(host, port, user, baseUrl);
    }

    private AppConfig readConfigQuietly() {
        String host = hostInput.getText().toString().trim();
        String user = userInput.getText().toString().trim();
        String base = tailnetBaseInput.getText().toString().trim();
        int sshPort = parsePortOrDefault(portInput.getText().toString(), AppConfig.DEFAULT_PORT);
        return new AppConfig(host, sshPort, user, base);
    }

    private static int parsePortOrDefault(String value, int fallback) {
        try {
            int parsed = Integer.parseInt(value.trim());
            return parsed >= 1 && parsed <= 65535 ? parsed : fallback;
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private static String normalizeTailnetBaseInput(String raw) {
        if (raw == null) return "";
        String value = raw.replace("\u200B", "").replace("\uFEFF", "").trim();
        if (value.isEmpty()) return "";

        java.util.regex.Matcher url = java.util.regex.Pattern
                .compile("(?i)https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?")
                .matcher(value);
        if (url.find()) value = url.group();
        else if (!value.contains("://") && value.matches("(?i)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?/?")) {
            value = "https://" + value;
        }

        Uri parsed = Uri.parse(value);
        if (!"https".equalsIgnoreCase(parsed.getScheme()) || TextUtils.isEmpty(parsed.getHost())) return "";
        int port = parsed.getPort();
        if (port > 65535) return "";
        return "https://" + parsed.getHost() + (port > 0 ? ":" + port : "");
    }

    private void refreshModeUi(AppConfig config) {
        mobileUrlText.setText(config.mobileUrl());
        desktopUrlText.setText(config.desktopUrl());
        refreshVpnStatus();
    }

    private char[] readPassword() {
        int length = passwordInput.length();
        char[] value = new char[length];
        for (int i = 0; i < length; i++) value[i] = passwordInput.getText().charAt(i);
        return value;
    }

    private void setBusy(boolean busy) {
        commandRunning = busy;
        unlockButton.setEnabled(!busy && !hasCachedPassword());
        lockButton.setEnabled(!busy);
        boolean commandEnabled = !busy && hasCachedPassword();
        startButton.setEnabled(commandEnabled);
        statusButton.setEnabled(commandEnabled);
        stopButton.setEnabled(commandEnabled);
    }

    private void setUnlockedUi(boolean unlocked) {
        hostInput.setEnabled(!unlocked);
        portInput.setEnabled(!unlocked);
        userInput.setEnabled(!unlocked);
        tailnetBaseInput.setEnabled(!unlocked);
        passwordInput.setVisibility(unlocked ? View.GONE : View.VISIBLE);
        unlockButton.setVisibility(unlocked ? View.GONE : View.VISIBLE);
        lockButton.setVisibility(unlocked ? View.VISIBLE : View.GONE);
        unlockButton.setEnabled(!unlocked && !commandRunning);
        startButton.setEnabled(unlocked && !commandRunning);
        statusButton.setEnabled(unlocked && !commandRunning);
        stopButton.setEnabled(unlocked && !commandRunning);
    }

    private void lockAndClearPassword(String message, boolean updateUi) {
        mainHandler.removeCallbacks(autoLock);
        clearCachedPassword();
        if (updateUi && !isFinishing()) {
            passwordInput.getText().clear();
            setUnlockedUi(false);
            dshStatus.setText("未连接");
            dshStatus.setTextColor(Color.rgb(91, 101, 116));
            resultLog.setText(message);
        }
    }

    private void clearCachedPassword() {
        synchronized (passwordLock) {
            clearCachedPasswordLocked();
            activeConfig = null;
        }
    }

    private void clearCachedPasswordLocked() {
        if (cachedPassword != null) {
            Arrays.fill(cachedPassword, '\0');
            cachedPassword = null;
        }
    }

    private boolean hasCachedPassword() {
        synchronized (passwordLock) {
            return cachedPassword != null;
        }
    }

    private void scheduleAutoLock() {
        mainHandler.removeCallbacks(autoLock);
        mainHandler.postDelayed(autoLock, AUTO_LOCK_MS);
    }

    private boolean confirmHostKey(String host, String keyType, String fingerprint) {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicBoolean accepted = new AtomicBoolean(false);
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed()) {
                latch.countDown();
                return;
            }
            new AlertDialog.Builder(this)
                    .setTitle("首次连接：确认电脑身份")
                    .setMessage("主机：" + host + "\n类型：" + keyType + "\n\n指纹：\n" + fingerprint
                            + "\n\n请在电脑上核对 SSH 主机指纹后再信任。之后如果密钥改变，App 会拒绝连接。")
                    .setCancelable(false)
                    .setNegativeButton("拒绝", (dialog, which) -> latch.countDown())
                    .setPositiveButton("信任此电脑", (dialog, which) -> {
                        accepted.set(true);
                        latch.countDown();
                    })
                    .show();
        });
        try {
            return latch.await(2, TimeUnit.MINUTES) && accepted.get();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private void confirmResetHostKey() {
        AppConfig config = readConfig();
        if (config == null) return;
        new AlertDialog.Builder(this)
                .setTitle("重置 SSH 主机密钥？")
                .setMessage("仅当电脑重装 OpenSSH 或确认主机密钥已更换时使用。下次连接会重新显示指纹。")
                .setNegativeButton("取消", null)
                .setPositiveButton("重置", (dialog, which) -> {
                    sshController.clearPinnedHostKey(config);
                    lockAndClearPassword("已重置该电脑的 SSH 主机密钥记录。", true);
                })
                .show();
    }

    private void refreshVpnStatus() {
        boolean vpnConnected = isVpnConnected();
        vpnStatus.setText(vpnConnected ? "VPN 已连接 · 可以访问 Tailnet" : "未检测到 VPN · 正在准备 Tailscale");
        vpnStatus.setTextColor(vpnConnected ? Color.rgb(22, 125, 75) : Color.rgb(186, 80, 30));
    }

    private boolean isVpnConnected() {
        boolean vpnConnected = false;
        ConnectivityManager manager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager != null) {
            for (Network network : manager.getAllNetworks()) {
                NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
                if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
                    vpnConnected = true;
                    break;
                }
            }
        }
        return vpnConnected;
    }

    private void requestTailscaleConnection(boolean openAppIfNeeded) {
        if (isVpnConnected()) {
            tailscaleRequestRunning = false;
            refreshVpnStatus();
            Toast.makeText(this, "VPN 已经连接", Toast.LENGTH_SHORT).show();
            return;
        }
        if (tailscaleRequestRunning) return;

        tailscaleRequestRunning = true;
        vpnStatus.setText("正在请求 Tailscale 连接…");
        vpnStatus.setTextColor(Color.rgb(186, 108, 0));
        sendTailscaleConnectBroadcast();

        // Current Tailscale Android builds expose CONNECT_VPN. A second request helps when
        // the backend is still starting, especially on newer Android releases.
        mainHandler.postDelayed(() -> {
            if (!isDestroyed() && !isVpnConnected()) {
                sendTailscaleConnectBroadcast();
            }
        }, 2_000);

        mainHandler.postDelayed(() -> {
            if (isDestroyed()) return;
            tailscaleRequestRunning = false;
            if (isVpnConnected()) {
                refreshVpnStatus();
                Toast.makeText(this, "Tailscale 已连接", Toast.LENGTH_SHORT).show();
            } else if (openAppIfNeeded) {
                vpnStatus.setText("自动连接未完成 · 正在打开 Tailscale");
                launchTailscaleApp();
            } else {
                refreshVpnStatus();
            }
        }, 4_500);
    }

    private void sendTailscaleConnectBroadcast() {
        try {
            Intent connect = new Intent(TAILSCALE_CONNECT_ACTION);
            connect.setComponent(new ComponentName(TAILSCALE_PACKAGE, TAILSCALE_RECEIVER));
            sendBroadcast(connect);
        } catch (Exception error) {
            // The foreground fallback below provides a user-visible recovery path.
        }
    }

    private void launchTailscaleApp() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(TAILSCALE_PACKAGE);
        if (launch == null) {
            vpnStatus.setText("未找到 Tailscale App");
            resultLog.setText("没有检测到 Tailscale。请先从可信来源安装并登录 Tailscale。 ");
            Toast.makeText(this, "未安装 Tailscale", Toast.LENGTH_LONG).show();
            return;
        }
        try {
            startActivity(launch);
        } catch (Exception error) {
            resultLog.setText("无法打开 Tailscale：" + error.getMessage());
        }
    }

    private void openUrl(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception error) {
            Toast.makeText(this, "找不到可以打开网页的应用", Toast.LENGTH_SHORT).show();
        }
    }

    private void copyLinks() {
        AppConfig config = readConfig();
        if (config == null) return;
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard != null) {
            clipboard.setPrimaryClip(ClipData.newPlainText(
                    "DSH Tailnet URLs",
                    "移动端：" + config.mobileUrl() + "\n原始界面：" + config.desktopUrl()));
            Toast.makeText(this, "两个网址已复制", Toast.LENGTH_SHORT).show();
        }
    }

    private static String combineOutput(SshController.Result result) {
        StringBuilder output = new StringBuilder();
        if (!result.output.isEmpty()) output.append(result.output);
        if (!result.error.isEmpty()) {
            if (output.length() > 0) output.append('\n');
            output.append(result.error);
        }
        if (result.exitCode != 0) {
            if (output.length() > 0) output.append('\n');
            output.append("退出代码：").append(result.exitCode);
        }
        return output.toString().trim();
    }

    private static String friendlyError(Exception error) {
        String raw = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        String lower = raw.toLowerCase(Locale.ROOT);
        if (lower.contains("auth fail") || lower.contains("authentication")) {
            return "SSH 登录失败。请确认 Windows 用户名和密码；这里需要账户密码，不是 PIN。";
        }
        if (lower.contains("timeout") || lower.contains("timed out") || lower.contains("connection refused")) {
            return "无法连接电脑 SSH。请确认：手机 Tailscale 已连接、电脑在线、sshd 正在运行，并允许此手机访问 TCP 22。\n\n" + raw;
        }
        if (lower.contains("hostkey") || lower.contains("host key") || lower.contains("reject hostkey")) {
            return "SSH 主机密钥未受信任或已经改变。不要直接绕过；先在电脑核对指纹，确认确实更换后再点击“重置信任的 SSH 主机密钥”。\n\n" + raw;
        }
        return "操作失败：" + raw;
    }

    private interface Command {
        SshController.Result run(SshController controller, AppConfig config, char[] password) throws Exception;
    }
}
