package com.chen1.dshmobile;

import android.content.Context;

import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.JSchException;
import com.jcraft.jsch.Session;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.Properties;
import java.util.concurrent.TimeUnit;

final class SshController {
    static final class Result {
        final int exitCode;
        final String output;
        final String error;

        Result(int exitCode, String output, String error) {
            this.exitCode = exitCode;
            this.output = output.trim();
            this.error = error.trim();
        }

        boolean contains(String token) {
            return output.contains(token);
        }
    }

    private static final int CONNECT_TIMEOUT_MS = 12_000;
    private static final int COMMAND_TIMEOUT_MS = 25_000;

    private final Context appContext;
    private final PinnedHostKeyRepository.Confirmation confirmation;

    SshController(Context context, PinnedHostKeyRepository.Confirmation confirmation) {
        this.appContext = context.getApplicationContext();
        this.confirmation = confirmation;
    }

    Result probe(AppConfig config, char[] password) throws Exception {
        return execute(config, password, "cmd.exe /d /c echo DSH_MOBILE_AUTH_OK");
    }

    Result start(AppConfig config, char[] password) throws Exception {
        String task = quotePowerShell(AppConfig.TASK_NAME);
        String script = "$ErrorActionPreference='SilentlyContinue';"
                + "$task='" + task + "';"
                + "schtasks.exe /Run /TN $task *> $null;"
                + "Start-Sleep -Seconds 3;"
                + "if(netstat.exe -ano -p tcp | Select-String '^\\s*TCP\\s+\\S+:3080\\s+\\S+\\s+LISTENING\\s+\\d+\\s*$')"
                + "{Write-Output 'RUNNING'}else{Write-Output 'START_REQUESTED'}";
        return execute(config, password, encodedPowerShell(script));
    }

    Result status(AppConfig config, char[] password) throws Exception {
        String script = "$ErrorActionPreference='SilentlyContinue';"
                + "if(netstat.exe -ano -p tcp | Select-String '^\\s*TCP\\s+\\S+:3080\\s+\\S+\\s+LISTENING\\s+\\d+\\s*$')"
                + "{Write-Output 'RUNNING'}else{Write-Output 'STOPPED'}";
        return execute(config, password, encodedPowerShell(script));
    }

    Result stop(AppConfig config, char[] password) throws Exception {
        String task = quotePowerShell(AppConfig.TASK_NAME);
        String script = "$ErrorActionPreference='SilentlyContinue';"
                + "$task='" + task + "';"
                + "schtasks.exe /End /TN $task *> $null;"
                + "Start-Sleep -Milliseconds 400;"
                + "$pattern='^\\s*TCP\\s+\\S+:3080\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$';"
                + "$listenerPids=@(netstat.exe -ano -p tcp|Select-String $pattern|ForEach-Object{[int]$_.Matches[0].Groups[1].Value}|Sort-Object -Unique);"
                + "foreach($listenerPid in $listenerPids){taskkill.exe /PID $listenerPid /T /F *> $null};"
                + "Start-Sleep -Milliseconds 700;"
                + "if(netstat.exe -ano -p tcp | Select-String $pattern){Write-Output 'STILL_RUNNING';exit 1}"
                + "else{Write-Output 'STOPPED'}";
        return execute(config, password, encodedPowerShell(script));
    }

    void clearPinnedHostKey(AppConfig config) {
        new PinnedHostKeyRepository(appContext, config.hostId(), confirmation).clear();
    }

    private Result execute(AppConfig config, char[] password, String command) throws Exception {
        Session session = null;
        ChannelExec channel = null;
        ByteBuffer encodedPassword = StandardCharsets.UTF_8.encode(CharBuffer.wrap(password));
        byte[] passwordBytes = new byte[encodedPassword.remaining()];
        encodedPassword.get(passwordBytes);
        try {
            JSch jsch = new JSch();
            jsch.setHostKeyRepository(new PinnedHostKeyRepository(appContext, config.hostId(), confirmation));
            session = jsch.getSession(config.username, config.host, config.port);
            Properties options = new Properties();
            options.put("StrictHostKeyChecking", "yes");
            options.put("PreferredAuthentications", "password");
            // Android 8+ reliably provides these JCE algorithms. Windows OpenSSH creates
            // ECDSA and RSA host keys by default, so Ed25519/Bouncy Castle is not required.
            options.put("kex", "ecdh-sha2-nistp256,diffie-hellman-group14-sha256");
            options.put("server_host_key", "ecdsa-sha2-nistp256,rsa-sha2-512,rsa-sha2-256");
            options.put("cipher.s2c", "aes128-gcm@openssh.com,aes256-gcm@openssh.com,aes128-ctr,aes256-ctr");
            options.put("cipher.c2s", "aes128-gcm@openssh.com,aes256-gcm@openssh.com,aes128-ctr,aes256-ctr");
            session.setConfig(options);
            session.setPassword(passwordBytes);
            session.connect(CONNECT_TIMEOUT_MS);
            Arrays.fill(passwordBytes, (byte) 0);

            channel = (ChannelExec) session.openChannel("exec");
            channel.setCommand(command);
            channel.setInputStream(null);
            InputStream stdout = channel.getInputStream();
            InputStream stderr = channel.getErrStream();
            channel.connect(5_000);
            return readUntilClosed(channel, stdout, stderr);
        } finally {
            Arrays.fill(passwordBytes, (byte) 0);
            if (channel != null) channel.disconnect();
            if (session != null) session.disconnect();
        }
    }

    private static Result readUntilClosed(ChannelExec channel, InputStream stdout, InputStream stderr)
            throws IOException, InterruptedException, JSchException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ByteArrayOutputStream err = new ByteArrayOutputStream();
        byte[] buffer = new byte[2048];
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(COMMAND_TIMEOUT_MS);
        while (true) {
            drain(stdout, out, buffer);
            drain(stderr, err, buffer);
            if (channel.isClosed() && stdout.available() == 0 && stderr.available() == 0) break;
            if (System.nanoTime() > deadline) throw new JSchException("SSH command timed out");
            Thread.sleep(40);
        }
        return new Result(
                channel.getExitStatus(),
                out.toString(StandardCharsets.UTF_8.name()),
                err.toString(StandardCharsets.UTF_8.name()));
    }

    private static void drain(InputStream input, ByteArrayOutputStream output, byte[] buffer) throws IOException {
        while (input.available() > 0) {
            int count = input.read(buffer, 0, Math.min(buffer.length, input.available()));
            if (count < 0) return;
            output.write(buffer, 0, count);
        }
    }

    private static String encodedPowerShell(String script) {
        String encoded = Base64.getEncoder().encodeToString(script.getBytes(StandardCharsets.UTF_16LE));
        return "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand " + encoded;
    }

    private static String quotePowerShell(String value) {
        return value.replace("'", "''");
    }
}
