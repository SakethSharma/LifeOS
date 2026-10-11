package com.sakethsharma.lifeos.sms;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.Settings;
import android.provider.Telephony;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * Read-only access to the SMS inbox for LifeOS's on-device transaction
 * importer. It only reads (READ_SMS), only the inbox, only within the date
 * range asked for, and only after the user has granted the permission.
 * Messages are returned to the app's own web view on this phone; nothing is
 * logged or sent anywhere from here.
 *
 * Isolated on purpose: removing this file, its registration in MainActivity
 * and the READ_SMS line in AndroidManifest.xml disables the feature for a
 * build that must not request SMS access (e.g. a Google Play build).
 */
@CapacitorPlugin(
    name = "SmsInbox",
    permissions = { @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS }) }
)
public class SmsInboxPlugin extends Plugin {

    private static final int MAX_LIMIT = 500;
    private static final int MAX_BODY_CHARS = 2000;

    /**
     * Inbox messages with from <= date <= to (epoch ms), oldest first.
     * Paged with offset/limit so large inboxes are read in small pieces.
     */
    @PluginMethod
    public void query(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            call.reject("SMS permission not granted", "PERMISSION_DENIED");
            return;
        }

        long from = Math.max(0L, call.getLong("from", 0L));
        long to = call.getLong("to", System.currentTimeMillis());
        int offset = Math.max(0, call.getInt("offset", 0));
        int limit = Math.min(MAX_LIMIT, Math.max(1, call.getInt("limit", 300)));

        if (to < from) {
            call.reject("Invalid range", "INVALID_RANGE");
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        String[] projection = { Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE };
        String selection = Telephony.Sms.DATE + " >= ? AND " + Telephony.Sms.DATE + " <= ?";
        String[] args = { String.valueOf(from), String.valueOf(to) };

        JSArray messages = new JSArray();

        try (Cursor cursor = resolver.query(Telephony.Sms.Inbox.CONTENT_URI, projection, selection, args, Telephony.Sms.DATE + " ASC")) {
            if (cursor != null && cursor.moveToPosition(offset)) {
                int addressCol = cursor.getColumnIndex(Telephony.Sms.ADDRESS);
                int bodyCol = cursor.getColumnIndex(Telephony.Sms.BODY);
                int dateCol = cursor.getColumnIndex(Telephony.Sms.DATE);
                int count = 0;

                do {
                    String body = bodyCol >= 0 ? cursor.getString(bodyCol) : null;
                    if (body == null) continue;

                    JSObject message = new JSObject();
                    message.put("address", addressCol >= 0 && cursor.getString(addressCol) != null ? cursor.getString(addressCol) : "");
                    message.put("body", body.length() > MAX_BODY_CHARS ? body.substring(0, MAX_BODY_CHARS) : body);
                    message.put("date", dateCol >= 0 ? cursor.getLong(dateCol) : 0L);
                    messages.put(message);
                    count++;
                } while (count < limit && cursor.moveToNext());
            }
        } catch (SecurityException e) {
            call.reject("SMS permission not granted", "PERMISSION_DENIED");
            return;
        } catch (Exception e) {
            // No message content in errors or logs.
            call.reject("Could not read messages", "READ_FAILED");
            return;
        }

        JSObject result = new JSObject();
        result.put("messages", messages);
        call.resolve(result);
    }

    /** Opens LifeOS's page in Android Settings, for when the permission was permanently denied. */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
