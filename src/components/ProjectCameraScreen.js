import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
  usePhotoOutput,
  useVideoOutput,
} from "react-native-vision-camera";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ACCENT = "#58c7d6";
const MAX_VIDEO_SECONDS = 60;
// Raw zoom is a device-specific factor, not a display factor: on a triple-lens
// iPhone raw 1.0 is the ultra-wide (shown as 0.5x). Bounds are therefore taken
// from the running controller, and the badge shows displayableZoomFactor.
// Offered zoom steps, as multiples of the device's default (1x) lens.
const ZOOM_STEPS = [0.5, 1, 2];
const PREVIEW_START_TIMEOUT_MS = 3000;
const AUTOMATIC_PREVIEW_RETRIES = 1;
// Widest side cluster is flash + flip (44 + 8 + 44) plus edge padding; the
// centered title reserves this on both sides so it never overlaps a button.
const NAV_SIDE_RESERVED_WIDTH = 112;

// VisionCamera returns raw filesystem paths; RN image/upload APIs need file:// URLs.
const toFileUri = (path) => (String(path).startsWith("file://") ? path : `file://${path}`);

const IMPLEMENTATION_MODE = Platform.OS === "android" ? "compatible" : undefined;

const formatClock = (totalSeconds) => {
  const clamped = Math.max(0, Math.min(totalSeconds, MAX_VIDEO_SECONDS));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
};

export default function ProjectCameraScreen({
  visible,
  projectName,
  queueItems = [],
  onCapture,
  onRetryUpload,
  onClose,
}) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef(null);
  const captureBusyRef = useRef(false);
  const activeRecorderRef = useRef(null);
  // Poster frame grabbed when a recording starts, attached when it finishes.
  const pendingPosterRef = useRef(null);
  const controllerRef = useRef(null);
  const deviceIdRef = useRef(null);
  const zoomBoundsRef = useRef({ min: 1, max: 1, neutral: 1 });
  const closeAfterRecordingRef = useRef(false);
  const automaticPermissionRequestRef = useRef(false);
  const cameraPermission = useCameraPermission();
  const microphonePermission = useMicrophonePermission();
  const [cameraReady, setCameraReady] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewRetryKey, setPreviewRetryKey] = useState(0);
  const [previewRetryCount, setPreviewRetryCount] = useState(0);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [cameraViewport, setCameraViewport] = useState(null);
  const [appState, setAppState] = useState(AppState.currentState || "active");
  const [facing, setFacing] = useState("back");
  const [mode, setMode] = useState("photo");
  const [flash, setFlash] = useState("off");
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [sessionCaptures, setSessionCaptures] = useState([]);
  const [error, setError] = useState("");
  const [viewerItem, setViewerItem] = useState(null);
  const [zoomMultiple, setZoomMultiple] = useState(1);

  // Ask for the virtual multi-lens device so the ultra-wide is part of the same
  // session; the default back device is wide-angle only, whose minimum zoom is
  // 1x, which is why no 0.5x step was offered.
  const backDevice = useCameraDevice("back", {
    physicalDevices: ["ultra-wide-angle", "wide-angle", "telephoto"],
  });
  const frontDevice = useCameraDevice("front");
  const device = (facing === "front" ? frontDevice : backDevice) || backDevice || frontDevice;
  const canFlip = Boolean(backDevice && frontDevice);
  const canUseFlash = mode === "video" ? Boolean(device?.hasTorch) : Boolean(device?.hasFlash);

  // Both outputs stay attached to the Camera at all times so toggling the
  // Photo/Video UI mode never reconfigures the native camera session.
  const photoOutput = usePhotoOutput({ containerFormat: "jpeg", quality: 0.85 });
  const videoOutput = useVideoOutput({ enableAudio: microphonePermission.hasPermission });
  const outputs = useMemo(() => [photoOutput, videoOutput], [photoOutput, videoOutput]);
  const cameraActive = visible && appState === "active";

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!visible) {
      automaticPermissionRequestRef.current = false;
      return;
    }
    if (
      cameraPermission.hasPermission ||
      !cameraPermission.canRequestPermission ||
      automaticPermissionRequestRef.current
    ) return;
    automaticPermissionRequestRef.current = true;
    cameraPermission.requestPermission();
  }, [cameraPermission.canRequestPermission, cameraPermission.hasPermission, cameraPermission.requestPermission, visible]);

  // A running capture session does not guarantee that iOS has attached and
  // started its AVCaptureVideoPreviewLayer. If the first preview frame never
  // arrives, remount the native view once, then expose a manual retry instead
  // of silently letting the user take photos against a black screen.
  useEffect(() => {
    if (!cameraActive || !cameraReady || previewReady || previewFailed) return undefined;
    const timeout = setTimeout(() => {
      if (previewRetryCount < AUTOMATIC_PREVIEW_RETRIES) {
        console.warn("[project-camera] Preview did not start; remounting native camera view", {
          retry: previewRetryCount + 1,
          device: device?.id,
        });
        setError("Restarting camera preview…");
        setCameraReady(false);
        setPreviewReady(false);
        setPreviewRetryCount((count) => count + 1);
        setPreviewRetryKey((key) => key + 1);
      } else {
        console.error("[project-camera] Preview failed to start after retry", {
          device: device?.id,
        });
        setPreviewFailed(true);
        setError("The camera preview did not start.");
      }
    }, PREVIEW_START_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [cameraActive, cameraReady, device?.id, previewFailed, previewReady, previewRetryCount]);

  useEffect(() => {
    if (!recording) {
      setRecordSeconds(0);
      return undefined;
    }
    const startedAt = Date.now();
    const interval = setInterval(
      () => setRecordSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      500,
    );
    return () => clearInterval(interval);
  }, [recording]);

  useEffect(() => {
    if (visible) return;
    setCameraReady(false);
    setPreviewReady(false);
    setPreviewRetryCount(0);
    setPreviewFailed(false);
    setCameraViewport(null);
    setError("");
    setMode("photo");
    setRecording(false);
    setSessionCaptures([]);
    setViewerItem(null);
    pendingPosterRef.current = null;
    closeAfterRecordingRef.current = false;
    if (activeRecorderRef.current) {
      activeRecorderRef.current.stopRecording().catch(() => {});
      activeRecorderRef.current = null;
    }
  }, [visible]);

  useEffect(() => {
    if (cameraActive) return;
    setCameraReady(false);
    setPreviewReady(false);
  }, [cameraActive]);

  // Zoom step buttons sit alongside the native pinch gesture; each press is a
  // single native call rather than a stream of them.
  const selectZoom = (multiple) => {
    const controller = controllerRef.current;
    if (!controller) return;
    const { min, max, neutral } = zoomBoundsRef.current;
    const raw = Math.min(Math.max(neutral * multiple, min), max);
    setZoomMultiple(multiple);
    Promise.resolve(controller.setZoom(raw)).catch((zoomError) => {
      console.warn("[project-camera] Could not set zoom", zoomError);
    });
  };

  // Every <Camera> prop below is kept referentially stable. Inline arrows and
  // array literals made React.memo useless, so any state change on this screen
  // re-rendered the native camera view.
  deviceIdRef.current = device?.id ?? null;

  const cameraStyle = useMemo(
    () => [styles.cameraPreview, cameraViewport],
    [cameraViewport],
  );

  const handleCameraStarted = useCallback(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps -- device read for logging only
    console.info("[project-camera] Capture session started", {
      device: deviceIdRef.current,
      lenses: (device?.physicalDevices || []).map((lens) => lens?.type).join(","),
      minZoom: device?.minZoom,
      maxZoom: device?.maxZoom,
    });
    // The controller exists only once the session runs. Its current zoom is the
    // device's default lens, which is 1x to the user: on a triple-lens iPhone
    // that is raw 2.0, and raw 1.0 would be the 0.5x ultra-wide.
    const controller = cameraRef.current?.controller ?? null;
    controllerRef.current = controller;
    const neutral = controller?.zoom ?? 1;
    zoomBoundsRef.current = {
      neutral,
      min: controller?.minZoom ?? neutral,
      max: controller?.maxZoom ?? neutral,
    };
    setZoomMultiple(1);
    setCameraReady(true);
  }, [device]);

  const handleCameraStopped = useCallback(() => {
    controllerRef.current = null;
    setCameraReady(false);
    setPreviewReady(false);
  }, []);

  const handlePreviewStarted = useCallback(() => {
    console.info("[project-camera] Preview received its first frame", {
      device: deviceIdRef.current,
    });
    setPreviewReady(true);
    setPreviewFailed(false);
    setError("");
  }, []);

  const handlePreviewStopped = useCallback(() => setPreviewReady(false), []);

  const handleCameraError = useCallback((cameraError) => {
    console.error("[project-camera] Native camera error", cameraError);
    setError(cameraError?.message || "Camera preview unavailable.");
  }, []);

  const retryPreview = () => {
    setError("");
    setCameraReady(false);
    setPreviewReady(false);
    setPreviewFailed(false);
    setPreviewRetryCount(0);
    setPreviewRetryKey((key) => key + 1);
  };

  const rememberCapture = (uri, kind, posterUri) => {
    setSessionCaptures((current) => [{ uri, kind, posterUri }, ...current]);
  };

  // Videos have no thumbnail of their own, so grab the live preview frame at
  // the moment recording starts and use it as the filmstrip poster.
  const capturePosterFrame = async () => {
    try {
      const snapshot = await cameraRef.current?.takeSnapshot();
      if (!snapshot) return null;
      // Let the image pick its own temporary path: building one from the cache
      // directory relied on a writable location and a path format this API
      // spells out differently (plain path, no file:// prefix).
      const path = await snapshot.saveToTemporaryFileAsync("jpg", 70);
      return path ? toFileUri(path) : null;
    } catch (posterError) {
      console.warn("[project-camera] Could not capture poster frame", posterError);
      return null;
    }
  };

  const flipFacing = () => {
    if (!canFlip) return;
    setCameraReady(false);
    setPreviewReady(false);
    setPreviewFailed(false);
    setPreviewRetryCount(0);
    // Zoom bounds and starting value come from the new device in onStarted.
    setFacing((current) => (current === "back" ? "front" : "back"));
  };

  const ensureMicrophonePermission = async () => {
    if (microphonePermission.hasPermission) return true;
    if (microphonePermission.canRequestPermission) {
      return microphonePermission.requestPermission();
    }
    return false;
  };

  const chooseMode = async (nextMode) => {
    if (recording || nextMode === mode) return;
    if (nextMode === "video" && !(await ensureMicrophonePermission())) {
      setError("Microphone access is required to record video with sound. Enable it in Settings.");
      return;
    }
    setError("");
    setMode(nextMode);
  };

  const capturePhoto = async () => {
    if (!cameraReady || !previewReady || captureBusyRef.current || recording) return;
    captureBusyRef.current = true;
    setError("");
    try {
      const photoFile = await photoOutput.capturePhotoToFile(
        {
          flashMode: flash === "on" && device?.hasFlash ? "on" : "off",
          enableShutterSound: true,
        },
        {},
      );
      const uri = toFileUri(photoFile.filePath);
      const dimensions = await new Promise((resolve) => {
        Image.getSize(uri, (width, height) => resolve({ width, height }), () => resolve({}));
      });
      const capturedAt = Date.now();
      rememberCapture(uri, "image");
      onCapture?.({
        uri,
        width: dimensions.width,
        height: dimensions.height,
        mimeType: "image/jpeg",
        type: "image",
        fileName: `project-${capturedAt}.jpg`,
        creationTime: capturedAt,
      });
    } catch (nextError) {
      setError(nextError?.message || "The photo could not be captured.");
    } finally {
      captureBusyRef.current = false;
    }
  };

  const finishRecording = () => {
    activeRecorderRef.current = null;
    setRecording(false);
    if (closeAfterRecordingRef.current) {
      closeAfterRecordingRef.current = false;
      onClose?.();
    }
  };

  const toggleRecording = async () => {
    if (!cameraReady || !previewReady) return;
    if (recording) {
      activeRecorderRef.current?.stopRecording().catch(() => {});
      return;
    }
    if (captureBusyRef.current) return;
    if (!(await ensureMicrophonePermission())) {
      setError("Microphone access is required to record video with sound. Enable it in Settings.");
      return;
    }

    captureBusyRef.current = true;
    setError("");
    try {
      pendingPosterRef.current = await capturePosterFrame();
      const recorder = await videoOutput.createRecorder({ maxDuration: MAX_VIDEO_SECONDS });
      const startedAt = Date.now();
      await recorder.startRecording(
        (filePath) => {
          const uri = toFileUri(filePath);
          rememberCapture(uri, "video", pendingPosterRef.current);
          pendingPosterRef.current = null;
          onCapture?.({
            uri,
            mimeType: Platform.OS === "ios" ? "video/quicktime" : "video/mp4",
            type: "video",
            duration: Date.now() - startedAt,
            fileName: `project-${startedAt}.${Platform.OS === "ios" ? "mov" : "mp4"}`,
            creationTime: startedAt,
          });
          finishRecording();
        },
        (recordError) => {
          setError(recordError?.message || "The video could not be recorded.");
          finishRecording();
        },
      );
      activeRecorderRef.current = recorder;
      setRecording(true);
    } catch (nextError) {
      setError(nextError?.message || "The video could not be recorded.");
      activeRecorderRef.current = null;
      setRecording(false);
    } finally {
      captureBusyRef.current = false;
    }
  };

  const closeCamera = () => {
    if (recording) {
      closeAfterRecordingRef.current = true;
      activeRecorderRef.current?.stopRecording().catch(() => {});
      return;
    }
    onClose?.();
  };

  // Keep every capture visible for the full camera session. Queue entries carry
  // the live upload state; the brief gap before enqueueing is treated as queued.
  const filmstripItems = useMemo(() => {
    const queueByUri = new Map();
    queueItems.forEach((item) => {
      if (item.asset?.uri) queueByUri.set(item.asset.uri, item);
    });
    const matchedIds = new Set();
    const fromSession = sessionCaptures.map((capture) => {
      const queueItem = queueByUri.get(capture.uri);
      if (queueItem) matchedIds.add(queueItem.localId);
      return {
        key: capture.uri,
        uri: capture.uri,
        posterUri: capture.posterUri,
        kind: capture.kind,
        status: queueItem ? queueItem.status : "queued",
        attempts: queueItem?.attempts || 0,
        localId: queueItem?.localId,
      };
    });
    const fromQueue = queueItems
      .filter((item) => !matchedIds.has(item.localId))
      .map((item) => ({
        key: item.localId,
        uri: item.asset?.uri,
        kind: item.kind === "video" ? "video" : "image",
        status: item.status,
        attempts: item.attempts || 0,
        localId: item.localId,
      }))
      .reverse();
    return [...fromSession, ...fromQueue];
  }, [queueItems, sessionCaptures]);

  const describeStatus = (item) => {
    if (item.status === "uploaded") return "uploaded";
    if (item.status === "uploading") return "uploading";
    if (item.status === "failed") return "upload failed, tap to retry";
    if (item.attempts > 0) return "retrying upload";
    return "waiting to upload";
  };

  const renderStatusBadge = (item) => {
    if (item.status === "uploading") return <ActivityIndicator size={10} color="#fff" />;
    if (item.status === "uploaded") return <Ionicons name="checkmark" size={11} color="#fff" />;
    if (item.status === "failed") return <Ionicons name="refresh" size={11} color="#fff" />;
    if (item.attempts > 0) return <Ionicons name="sync" size={11} color="#fff" />;
    return <Ionicons name="time-outline" size={11} color="#fff" />;
  };

  const permissionBlocked = !cameraPermission.hasPermission && !cameraPermission.canRequestPermission;
  const permissionMissing = !cameraPermission.hasPermission;
  const captureReady = cameraReady && previewReady;
  const uploadCount = queueItems.filter((item) => item.status !== "uploaded").length;
  const topInset = Math.max(insets.top, 14);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={closeCamera}
    >
      <View
        style={styles.screen}
        onLayout={({ nativeEvent }) => {
          const { width, height } = nativeEvent.layout;
          if (width <= 0 || height <= 0) return;
          setCameraViewport((current) =>
            current?.width === width && current?.height === height ? current : { width, height },
          );
        }}
      >
        <StatusBar style="light" backgroundColor="#050708" />
        {visible && cameraPermission.hasPermission && device && cameraViewport ? (
          <Camera
            key={`${device.id}-${facing}-${previewRetryKey}`}
            ref={cameraRef}
            style={cameraStyle}
            isActive={cameraActive}
            device={device}
            // VisionCamera's own native pinch recognizer: runs entirely in
            // native code, so no zoom update crosses the JS bridge. Cannot be
            // combined with a `zoom` prop; the step buttons call setZoom instead.
            enableNativeZoomGesture
            enableNativeTapToFocusGesture
            outputs={outputs}
            resizeMode="cover"
            implementationMode={IMPLEMENTATION_MODE}
            mirrorMode={facing === "front" ? "on" : "off"}
            torchMode={mode === "video" && flash === "on" && device.hasTorch ? "on" : "off"}
            onStarted={handleCameraStarted}
            onStopped={handleCameraStopped}
            onPreviewStarted={handlePreviewStarted}
            onPreviewStopped={handlePreviewStopped}
            onError={handleCameraError}
          />
        ) : null}

        {!permissionMissing && device && !previewReady ? (
          <View pointerEvents="box-none" style={styles.previewStatusLayer}>
            <View style={styles.previewStatusCard}>
              {previewFailed ? (
                <Ionicons name="camera-outline" size={28} color="#fff" />
              ) : (
                <ActivityIndicator color="#fff" />
              )}
              <Text style={styles.previewStatusTitle}>
                {previewFailed ? "Camera preview unavailable" : "Starting camera…"}
              </Text>
              {previewFailed ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry camera preview"
                  style={styles.previewRetryButton}
                  onPress={retryPreview}
                >
                  <Ionicons name="refresh" size={18} color="#0b2025" />
                  <Text style={styles.previewRetryButtonText}>Retry camera</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {permissionMissing ? (
          <View style={styles.permissionCard}>
            <Ionicons name="camera-outline" size={42} color="#fff" />
            <Text style={styles.permissionTitle}>Camera access needed</Text>
            <Text style={styles.permissionText}>
              ServiceFlow needs camera access to capture project photos and videos.
            </Text>
            <Pressable
              style={styles.permissionButton}
              onPress={permissionBlocked ? Linking.openSettings : cameraPermission.requestPermission}
            >
              <Text style={styles.permissionButtonText}>
                {permissionBlocked ? "Open Settings" : "Allow Camera"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View style={[styles.topBar, { paddingTop: topInset }]}>
          <View style={styles.navRow}>
            <View pointerEvents="none" style={styles.navTitleLayer}>
              <Text style={styles.projectName} numberOfLines={1}>{projectName || "Project"}</Text>
              <Text style={styles.projectSubline} numberOfLines={1}>
                {uploadCount ? `${uploadCount} upload${uploadCount === 1 ? "" : "s"} in progress` : "Project camera"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close camera"
              style={({ pressed }) => [styles.roundButton, pressed && styles.roundButtonPressed]}
              onPress={closeCamera}
              hitSlop={10}
            >
              <Ionicons name="close" size={26} color="#fff" />
            </Pressable>
            <View style={styles.topActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={flash === "on" ? "Turn flash off" : "Turn flash on"}
                accessibilityState={{ disabled: recording || !canUseFlash, selected: flash === "on" }}
                style={({ pressed }) => [
                  styles.roundButton,
                  flash === "on" && styles.roundButtonActive,
                  (recording || !canUseFlash) && styles.roundButtonDisabled,
                  pressed && styles.roundButtonPressed,
                ]}
                disabled={recording || !canUseFlash}
                hitSlop={6}
                onPress={() => setFlash((current) => (current === "on" ? "off" : "on"))}
              >
                <Ionicons name={flash === "on" ? "flash" : "flash-off"} size={20} color="#fff" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Flip camera"
                accessibilityState={{ disabled: recording || !canFlip }}
                style={({ pressed }) => [
                  styles.roundButton,
                  (recording || !canFlip) && styles.roundButtonDisabled,
                  pressed && styles.roundButtonPressed,
                ]}
                disabled={recording || !canFlip}
                hitSlop={6}
                onPress={flipFacing}
              >
                <Ionicons name="camera-reverse-outline" size={22} color="#fff" />
              </Pressable>
            </View>
          </View>
        </View>

        <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, 16) + 10 }]}>
          {error ? (
            <View style={styles.errorPill}>
              <Ionicons name="alert-circle" size={16} color="#fff" />
              <Text style={styles.errorText} numberOfLines={2}>{error}</Text>
            </View>
          ) : null}

          {filmstripItems.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.sessionStrip}
            >
              {filmstripItems.map((item) => (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.kind === "video" ? "video" : "photo"} capture, ${describeStatus(item)}`}
                  disabled={!item.uri}
                  onPress={() => setViewerItem(item)}
                  style={({ pressed }) => [styles.sessionItem, pressed && styles.sessionItemPressed]}
                >
                  {item.kind === "video" ? (
                    <View style={styles.sessionThumb}>
                      {item.posterUri ? (
                        <Image source={{ uri: item.posterUri }} style={styles.sessionThumb} />
                      ) : (
                        <View style={[styles.sessionThumb, styles.videoThumb]}>
                          <Ionicons name="videocam" size={20} color="#fff" />
                        </View>
                      )}
                      <View style={styles.videoBadge}>
                        <Ionicons name="play" size={11} color="#fff" />
                      </View>
                    </View>
                  ) : item.uri ? (
                    <Image source={{ uri: item.uri }} style={styles.sessionThumb} />
                  ) : (
                    <View style={[styles.sessionThumb, styles.videoThumb]} />
                  )}
                  {item.status === "failed" ? (
                    <View style={styles.sessionFailedOverlay}>
                      <Ionicons name="alert" size={16} color="#fff" />
                    </View>
                  ) : null}
                  <View style={[
                    styles.sessionStatus,
                    item.status === "uploaded" && styles.sessionStatusUploaded,
                    item.status === "failed" && styles.sessionStatusFailed,
                    item.status === "queued" && item.attempts > 0 && styles.sessionStatusRetrying,
                  ]}>
                    {renderStatusBadge(item)}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {recording ? (
            <View
              style={styles.recordingPill}
              accessibilityRole="timer"
              accessibilityLabel={`Recording, ${recordSeconds} of ${MAX_VIDEO_SECONDS} seconds`}
            >
              <View style={styles.recordingDot} />
              <Text style={styles.recordingTime}>
                {formatClock(recordSeconds)} / {formatClock(MAX_VIDEO_SECONDS)}
              </Text>
            </View>
          ) : null}

          {previewReady ? (
            <View style={styles.zoomRow}>
              {ZOOM_STEPS.filter((step) => {
                const { min, max, neutral } = zoomBoundsRef.current;
                const raw = neutral * step;
                return step === 1 || (raw >= min && raw <= max);
              }).map((step) => (
                <Pressable
                  key={step}
                  accessibilityRole="button"
                  accessibilityLabel={`Zoom ${step}x`}
                  accessibilityState={{ selected: zoomMultiple === step }}
                  hitSlop={8}
                  onPress={() => selectZoom(step)}
                  style={[
                    styles.zoomStep,
                    zoomMultiple === step && styles.zoomStepActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.zoomStepText,
                      zoomMultiple === step && styles.zoomStepTextActive,
                    ]}
                  >
                    {step === 1 ? "1×" : `${step}×`}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={styles.modeSwitch}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Photo mode"
              accessibilityState={{ selected: mode === "photo", disabled: recording }}
              hitSlop={8}
              disabled={recording}
              onPress={() => chooseMode("photo")}
              style={[styles.modeSegment, mode === "photo" && styles.modeSegmentActive]}
            >
              <Ionicons
                name="camera"
                size={15}
                color={mode === "photo" ? "#0b1518" : "rgba(255,255,255,0.72)"}
              />
              <Text style={[styles.modeSegmentText, mode === "photo" && styles.modeSegmentTextActive]}>
                Photo
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Video mode"
              accessibilityState={{ selected: mode === "video", disabled: recording }}
              hitSlop={8}
              disabled={recording}
              onPress={() => chooseMode("video")}
              style={[styles.modeSegment, mode === "video" && styles.modeSegmentActive]}
            >
              <Ionicons
                name="videocam"
                size={15}
                color={mode === "video" ? "#0b1518" : "rgba(255,255,255,0.72)"}
              />
              <Text style={[styles.modeSegmentText, mode === "video" && styles.modeSegmentTextActive]}>
                Video
              </Text>
            </Pressable>
          </View>

          <View style={styles.shutterRow}>
            <View style={styles.shutterSpacer} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={recording ? "Stop recording" : mode === "video" ? "Record video" : "Take photo"}
              disabled={!captureReady || permissionMissing}
              style={[
                styles.shutterOuter,
                recording && styles.shutterOuterRecording,
                (!captureReady || permissionMissing) && styles.shutterDisabled,
              ]}
              onPress={mode === "video" ? toggleRecording : capturePhoto}
            >
              {({ pressed }) => (
                <View style={[
                  styles.shutterInner,
                  mode === "video" && styles.videoShutter,
                  recording && styles.videoShutterRecording,
                  pressed && !recording && styles.shutterInnerPressed,
                ]} />
              )}
            </Pressable>
            <View style={styles.shutterSpacer}>
              {uploadCount ? (
                <View style={styles.captureCounter}>
                  <Text style={styles.captureCounterText}>{uploadCount}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {viewerItem ? (
          <CaptureViewer
            item={viewerItem}
            insets={insets}
            statusLabel={describeStatus(viewerItem)}
            onRetryUpload={onRetryUpload}
            onClose={() => setViewerItem(null)}
          />
        ) : null}
      </View>
    </Modal>
  );
}

// Rendered only while a capture is open so the video player is created and torn
// down with the viewer rather than living for the whole camera session.
function CaptureViewer({ item, insets, statusLabel, onRetryUpload, onClose }) {
  const isVideo = item.kind === "video";
  const player = useVideoPlayer(isVideo ? item.uri : null, (instance) => {
    if (!instance) return;
    instance.loop = true;
    instance.play();
  });

  return (
    <View style={[styles.viewerLayer, { paddingTop: Math.max(insets.top, 14) }]}>
      {isVideo ? (
        <VideoView
          player={player}
          style={styles.viewerMedia}
          contentFit="contain"
          nativeControls
        />
      ) : (
        <Image source={{ uri: item.uri }} style={styles.viewerMedia} resizeMode="contain" />
      )}

      <View style={[styles.viewerBar, { paddingTop: Math.max(insets.top, 14) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close preview"
          style={({ pressed }) => [styles.roundButton, pressed && styles.roundButtonPressed]}
          onPress={onClose}
          hitSlop={10}
        >
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <Text style={styles.viewerStatus} numberOfLines={1}>{statusLabel}</Text>
      </View>

      {item.status === "failed" && item.localId ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry upload"
          style={[styles.viewerRetry, { bottom: Math.max(insets.bottom, 16) + 16 }]}
          onPress={() => {
            onRetryUpload?.(item.localId);
            onClose();
          }}
        >
          <Ionicons name="refresh" size={18} color="#0b2025" />
          <Text style={styles.previewRetryButtonText}>Retry upload</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#050708" },
  cameraPreview: { position: "absolute", top: 0, left: 0 },
  zoomRow: {
    alignSelf: "center",
    flexDirection: "row",
    gap: 6,
    marginBottom: 10,
  },
  zoomStep: {
    minWidth: 34,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 7,
    backgroundColor: "rgba(18,26,30,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  zoomStepActive: { backgroundColor: "#fff", borderColor: "#fff" },
  zoomStepText: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 12,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  zoomStepTextActive: { color: "#0b1518" },
  videoBadge: {
    position: "absolute",
    left: 3,
    bottom: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8,15,18,0.72)",
  },
  viewerLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
    backgroundColor: "#05080a",
    alignItems: "center",
    justifyContent: "center",
  },
  viewerMedia: { width: "100%", height: "100%" },
  viewerBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingBottom: 12,
    backgroundColor: "rgba(4,8,10,0.5)",
  },
  viewerStatus: { flex: 1, color: "rgba(255,255,255,0.82)", fontSize: 13, fontWeight: "700" },
  viewerRetry: {
    position: "absolute",
    alignSelf: "center",
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: ACCENT,
  },
  previewStatusLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "box-none",
  },
  previewStatusCard: {
    minWidth: 220,
    alignItems: "center",
    paddingHorizontal: 22,
    paddingVertical: 18,
    borderRadius: 18,
    backgroundColor: "rgba(8,15,18,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  previewStatusTitle: { marginTop: 10, color: "#fff", fontSize: 14, fontWeight: "800" },
  previewRetryButton: {
    marginTop: 14,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: ACCENT,
  },
  previewRetryButtonText: { color: "#0b2025", fontSize: 14, fontWeight: "900" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    paddingHorizontal: 14,
    paddingBottom: 12,
    backgroundColor: "rgba(4,8,10,0.56)",
  },
  navRow: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navTitleLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: NAV_SIDE_RESERVED_WIDTH,
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18,26,30,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  roundButtonActive: { backgroundColor: "rgba(43,132,150,0.9)", borderColor: "rgba(255,255,255,0.45)" },
  roundButtonPressed: { opacity: 0.7 },
  roundButtonDisabled: { opacity: 0.4 },
  projectName: { color: "#fff", fontSize: 15, fontWeight: "800", textAlign: "center" },
  projectSubline: {
    color: "rgba(255,255,255,0.66)",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
    textAlign: "center",
  },
  topActions: { flexDirection: "row", gap: 8 },
  controls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
    paddingTop: 14,
    backgroundColor: "rgba(4,8,10,0.68)",
  },
  sessionStrip: { paddingHorizontal: 14, gap: 8, paddingBottom: 12 },
  sessionItem: { width: 48, height: 48, borderRadius: 9, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.5)" },
  sessionItemPressed: { opacity: 0.7 },
  sessionThumb: { width: "100%", height: "100%" },
  videoThumb: { alignItems: "center", justifyContent: "center", backgroundColor: "#223746" },
  sessionFailedOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(160,48,36,0.45)",
  },
  sessionStatus: { position: "absolute", right: 3, bottom: 3, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(20,86,97,0.92)" },
  sessionStatusUploaded: { backgroundColor: "#2e9e5b" },
  sessionStatusFailed: { backgroundColor: "#c24836" },
  sessionStatusRetrying: { backgroundColor: "#b07c1f" },
  modeSwitch: {
    alignSelf: "center",
    flexDirection: "row",
    padding: 3,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    marginBottom: 12,
  },
  modeSegment: {
    minWidth: 88,
    minHeight: 34,
    borderRadius: 17,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 12,
  },
  modeSegmentActive: { backgroundColor: "#fff" },
  modeSegmentText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  modeSegmentTextActive: { color: "#0b1518" },
  shutterRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  shutterSpacer: { flex: 1, alignItems: "center" },
  shutterOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterOuterRecording: { borderColor: "#ef4d4d" },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#fff" },
  shutterInnerPressed: { width: 56, height: 56, borderRadius: 28, opacity: 0.85 },
  videoShutter: { backgroundColor: "#ef4d4d" },
  videoShutterRecording: { width: 32, height: 32, borderRadius: 8, backgroundColor: "#ef4d4d" },
  shutterDisabled: { opacity: 0.45 },
  captureCounter: { minWidth: 38, height: 38, paddingHorizontal: 10, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(43,132,150,0.92)", borderWidth: 1, borderColor: "rgba(255,255,255,0.6)" },
  captureCounterText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  recordingPill: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 15,
    backgroundColor: "rgba(160,36,30,0.92)",
    marginBottom: 12,
  },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  recordingTime: { color: "#fff", fontSize: 15, fontWeight: "900", fontVariant: ["tabular-nums"] },
  errorPill: { marginHorizontal: 14, marginBottom: 12, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "rgba(160,48,36,0.9)" },
  errorText: { flex: 1, color: "#fff", fontSize: 12, fontWeight: "700" },
  permissionCard: { ...StyleSheet.absoluteFillObject, zIndex: 3, alignItems: "center", justifyContent: "center", paddingHorizontal: 34, backgroundColor: "#10181c" },
  permissionTitle: { marginTop: 16, color: "#fff", fontSize: 21, fontWeight: "900" },
  permissionText: { marginTop: 8, color: "rgba(255,255,255,0.72)", fontSize: 14, lineHeight: 20, textAlign: "center", fontWeight: "600" },
  permissionButton: { marginTop: 22, minWidth: 150, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 14, alignItems: "center", backgroundColor: ACCENT },
  permissionButtonText: { color: "#0b2025", fontSize: 14, fontWeight: "900" },
});
