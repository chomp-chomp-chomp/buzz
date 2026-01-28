"use client";

type InstallStatus = {
  isInstalled: boolean;
  displayModeStandalone: boolean;
  navigatorStandalone: boolean;
};

export type NotificationStatus = {
  permission: NotificationPermission | "unsupported";
  statusLabel: "Enabled" | "Not enabled" | "Denied" | "Not installed";
  secondaryText: string;
  isInstalled: boolean;
  subscriptionExists: boolean;
  supportsServiceWorker: boolean;
  supportsPush: boolean;
};

export function getInstallStatus(): InstallStatus {
  if (typeof window === "undefined") {
    return {
      isInstalled: false,
      displayModeStandalone: false,
      navigatorStandalone: false,
    };
  }

  const displayModeStandalone = window.matchMedia?.("(display-mode: standalone)")
    .matches ?? false;
  const navigatorStandalone = (window.navigator as { standalone?: boolean }).standalone === true;

  return {
    isInstalled: displayModeStandalone || navigatorStandalone,
    displayModeStandalone,
    navigatorStandalone,
  };
}

export async function getNotificationStatus(): Promise<NotificationStatus> {
  const { isInstalled } = getInstallStatus();
  const supportsNotification = typeof window !== "undefined" && "Notification" in window;
  const supportsServiceWorker = typeof navigator !== "undefined" && "serviceWorker" in navigator;
  const supportsPush = typeof window !== "undefined" && "PushManager" in window;
  const permission: NotificationPermission | "unsupported" = supportsNotification
    ? Notification.permission
    : "unsupported";
  const isIos =
    typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

  let subscriptionExists = false;
  if (permission === "granted" && supportsServiceWorker && supportsPush) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        const subscription = await registration.pushManager.getSubscription();
        subscriptionExists = !!subscription;
      }
    } catch (error) {
      console.warn("Push subscription check failed:", error);
    }
  }

  let statusLabel: NotificationStatus["statusLabel"] = "Not enabled";
  let secondaryText = "";

  if (isIos && !isInstalled) {
    statusLabel = "Not installed";
    secondaryText = "Install to Home Screen to enable notifications on iPhone.";
  } else if (permission === "denied") {
    statusLabel = "Denied";
    secondaryText = "Enable in Settings to receive buzzes.";
  } else if (permission === "granted") {
    statusLabel = "Enabled";
    if (!subscriptionExists) {
      secondaryText = "Turned on, but not subscribed.";
    }
  } else if (permission === "default") {
    statusLabel = "Not enabled";
    secondaryText = "Tap to enable notifications.";
  } else {
    statusLabel = "Not enabled";
    secondaryText = "Notifications are not supported in this browser.";
  }

  return {
    permission,
    statusLabel,
    secondaryText,
    isInstalled,
    subscriptionExists,
    supportsServiceWorker,
    supportsPush,
  };
}

export async function ensurePushSubscription({
  forceResubscribe,
}: {
  forceResubscribe: boolean;
}): Promise<{ subExists: boolean; sub: PushSubscription | null }> {
  if (typeof window === "undefined") {
    throw new Error("Push subscriptions require a browser context.");
  }
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not available.");
  }
  if (!("PushManager" in window)) {
    throw new Error("Push notifications are not supported.");
  }
  if (!("Notification" in window) || Notification.permission !== "granted") {
    throw new Error("Notifications are not granted.");
  }

  const existingRegistration = await navigator.serviceWorker.getRegistration();
  if (!existingRegistration) {
    await navigator.serviceWorker.register("/sw.js");
  }

  const readyRegistration = await navigator.serviceWorker.ready;

  let subscription = await readyRegistration.pushManager.getSubscription();

  if (forceResubscribe && subscription) {
    await subscription.unsubscribe();
    subscription = null;
  }

  if (!subscription) {
    const vapidRes = await fetch("/api/vapid-key");
    const vapidData = (await vapidRes.json()) as { publicKey?: string | null };
    if (!vapidData.publicKey) {
      throw new Error("Missing VAPID key.");
    }

    subscription = await readyRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey),
    });
  }

  if (subscription) {
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Subscription save failed (${res.status}): ${body}`);
    }
  }

  return { subExists: !!subscription, sub: subscription };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}
