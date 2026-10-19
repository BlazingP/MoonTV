package com.blazing.tv;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.util.Log;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

/**
 * 遥控器应用键改键服务（类名沿用 HuluKeyService，改名会让系统关闭已开启的无障碍服务）。
 * Sony BRAVIA 的 Hulu / U-NEXT / YouTube 等应用键共用 keyCode 196，只能靠扫描码区分：
 *   Hulu   0x1e6 → Blazing TV
 *   U-NEXT 0x1e8 → Moonlight
 * 其他键（含 YouTube 0x1e5）原样交还系统。
 * 系统会先把按键交给无障碍服务过滤，再交给 GlobalKeyManager 启动对应应用，所以在这里吞掉即可改键。
 * 需要用户在「设置 → 系统 → 无障碍」里手动开启本服务。
 */
public class HuluKeyService extends AccessibilityService {
    private static final String TAG = "BlazingTV";
    /** Sony 遥控器应用键共用的 keyCode。 */
    static final int APP_BUTTON_KEYCODE = 196;
    static final int SCAN_HULU = 0x1e6;
    static final int SCAN_UNEXT = 0x1e8;
    static final String MOONLIGHT_PACKAGE = "com.limelight";

    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        if (event.getKeyCode() != APP_BUTTON_KEYCODE) return false;
        Intent target = targetFor(event.getScanCode());
        // 没有映射（如 YouTube）或目标应用没装：交还系统，保持原有功能
        if (target == null) return false;
        if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
            launch(target);
        }
        // 按下和抬起都吞掉，避免系统再去打开原来的应用
        return true;
    }

    /** 根据扫描码决定要打开的应用；返回 null 表示不改这个键。 */
    private Intent targetFor(int scanCode) {
        switch (scanCode) {
            case SCAN_HULU:
                return new Intent(this, MainActivity.class)
                        .setAction(Intent.ACTION_MAIN)
                        .addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
            case SCAN_UNEXT:
                return launchIntentForPackage(MOONLIGHT_PACKAGE);
            default:
                return null;
        }
    }

    private Intent launchIntentForPackage(String packageName) {
        PackageManager pm = getPackageManager();
        Intent intent = pm.getLeanbackLaunchIntentForPackage(packageName);
        return intent != null ? intent : pm.getLaunchIntentForPackage(packageName);
    }

    private void launch(Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        try {
            startActivity(intent);
        } catch (RuntimeException e) {
            Log.e(TAG, "遥控器改键启动应用失败: " + intent, e);
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // 只需要按键过滤，不处理任何界面事件
    }

    @Override
    public void onInterrupt() {
        // 无需处理
    }
}
