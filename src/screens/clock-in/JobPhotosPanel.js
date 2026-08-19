import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ProjectCameraScreen from "../../components/ProjectCameraScreen";
import { listProjectMedia } from "../../lib/projectMedia";
import { useProjectMediaUploadQueue } from "../../lib/useProjectMediaUploadQueue";
import { getProjectId } from "../../lib/projectRepository";

const NAVY = "#31495d";
const INK = "#11201d";
const MUTED = "#6d7f7b";
const WHITE = "#ffffff";
const HAIRLINE = "#e4eae8";

// Enough to show the job at a glance without turning the shift screen into a
// gallery; the rest are reachable through the count.
const PREVIEW_COUNT = 4;

export default function JobPhotosPanel({ project, onOpenAll, showCamera = true }) {
  const projectId = getProjectId(project);
  const projectKind = project?.is_lead ? "lead" : "job";
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const uploads = useProjectMediaUploadQueue({
    projectId,
    projectKind,
    onUploaded: (created, upload) => {
      if (String(upload?.projectId || "") !== String(projectId || "")) return;
      // Drop the finished upload in at the front so the strip and the count
      // move the moment a capture lands, without waiting for a refetch.
      setMedia((current) => [created, ...current.filter((item) => item.id !== created.id)]);
    },
  });

  const loadMedia = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { media: rows } = await listProjectMedia(projectId, { projectKind });
    setMedia(Array.isArray(rows) ? rows : []);
    setLoading(false);
  }, [projectId, projectKind]);

  useEffect(() => {
    loadMedia();
  }, [loadMedia]);

  const pending = useMemo(
    () => uploads.items.filter((item) => item.status !== "uploaded"),
    [uploads.items],
  );

  // Pending captures lead, so a photo taken seconds ago is the first thing seen.
  const previews = useMemo(() => {
    const fromQueue = pending.map((item) => ({
      key: item.localId,
      uri: item.asset?.uri,
      isVideo: item.kind === "video",
      pending: true,
      failed: item.status === "failed",
      localId: item.localId,
    }));
    const fromServer = media.map((item) => ({
      key: item.id,
      uri: item.media_type === "video" ? item.thumbnailUrl : item.url,
      headers: item.headers,
      isVideo: item.media_type === "video",
      pending: false,
    }));
    return [...fromQueue, ...fromServer].slice(0, PREVIEW_COUNT);
  }, [media, pending]);

  const total = media.length + pending.length;
  const remaining = Math.max(0, total - previews.length);

  const uploading = pending.filter((item) => item.status === "uploading").length;
  const failed = pending.filter((item) => item.status === "failed");
  // Surface why an upload stopped instead of leaving a capture sitting there
  // marked "waiting" with no explanation.
  const failureReason = failed[0]?.error || null;

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel="Open job photos"
        onPress={onOpenAll}
      >
        <Ionicons name="images-outline" size={17} color={NAVY} />
        <Text style={styles.title}>Photos</Text>
        {loading && !media.length ? (
          <ActivityIndicator size="small" color={MUTED} />
        ) : (
          <Text style={styles.count}>{total}</Text>
        )}
        <Ionicons name="chevron-forward" size={15} color={MUTED} />
      </Pressable>

      {previews.length ? (
        <Pressable
          style={styles.strip}
          accessibilityRole="button"
          accessibilityLabel={`View all ${total} photos and videos`}
          onPress={onOpenAll}
        >
          {previews.map((item) => (
            <View key={item.key} style={styles.thumb}>
              {item.uri ? (
                <Image
                  source={item.headers ? { uri: item.uri, headers: item.headers } : { uri: item.uri }}
                  style={styles.thumbImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.thumbImage, styles.thumbFallback]} />
              )}
              {item.isVideo ? (
                <View style={styles.videoBadge}>
                  <Ionicons name="play" size={10} color={WHITE} />
                </View>
              ) : null}
              {item.pending ? (
                <View style={styles.pendingOverlay}>
                  {item.failed ? (
                    <Ionicons name="alert" size={13} color={WHITE} />
                  ) : (
                    <ActivityIndicator size="small" color={WHITE} />
                  )}
                </View>
              ) : null}
            </View>
          ))}
          {remaining ? (
            <View style={[styles.thumb, styles.moreTile]}>
              <Text style={styles.moreText}>+{remaining}</Text>
            </View>
          ) : null}
        </Pressable>
      ) : (
        <Text style={styles.empty}>
          {loading ? "Loading photos…" : "No photos on this job yet."}
        </Text>
      )}

      {uploading ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={MUTED} />
          <Text style={styles.statusText}>
            Uploading {uploading} {uploading === 1 ? "item" : "items"}…
          </Text>
        </View>
      ) : null}

      {failed.length ? (
        <Pressable
          style={({ pressed }) => [styles.errorRow, pressed && styles.pressedDim]}
          accessibilityRole="button"
          accessibilityLabel="Retry failed uploads"
          onPress={uploads.retryAll}
        >
          <Ionicons name="alert-circle" size={15} color="#a5321f" />
          <Text style={styles.errorText} numberOfLines={2}>
            {failed.length} upload{failed.length === 1 ? "" : "s"} failed
            {failureReason ? `: ${failureReason}` : ""}. Tap to retry.
          </Text>
        </Pressable>
      ) : null}

      {showCamera ? (
        <>
          <Pressable
            style={({ pressed }) => [styles.cameraButton, pressed && styles.pressedDim]}
            accessibilityRole="button"
            accessibilityLabel="Take a photo or video for this job"
            disabled={!projectId}
            onPress={() => setCameraOpen(true)}
          >
            <Ionicons name="camera" size={19} color={WHITE} />
            <Text style={styles.cameraButtonText}>Take Photo or Video</Text>
          </Pressable>

          <ProjectCameraScreen
            visible={cameraOpen}
            projectName={project?.name || "Project"}
            queueItems={pending}
            onRetryUpload={uploads.retry}
            onCapture={(asset) => uploads.enqueue(asset)}
            onClose={() => setCameraOpen(false)}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: WHITE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, color: INK, fontSize: 14, fontWeight: "900" },
  count: { color: MUTED, fontSize: 13, fontWeight: "800", fontVariant: ["tabular-nums"] },
  strip: { flexDirection: "row", gap: 8, marginTop: 12 },
  thumb: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 9,
    overflow: "hidden",
    backgroundColor: "#dfe6e4",
  },
  thumbImage: { width: "100%", height: "100%" },
  thumbFallback: { backgroundColor: "#c9d4d1" },
  videoBadge: {
    position: "absolute",
    left: 4,
    bottom: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8,15,18,0.7)",
  },
  pendingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(17,32,29,0.45)",
  },
  moreTile: { alignItems: "center", justifyContent: "center", backgroundColor: "#eef2f1" },
  moreText: { color: NAVY, fontSize: 14, fontWeight: "900" },
  empty: { color: MUTED, fontSize: 12.5, fontWeight: "600", marginTop: 10 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  statusText: { color: MUTED, fontSize: 12.5, fontWeight: "700" },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: "#fdecea",
  },
  errorText: { flex: 1, color: "#a5321f", fontSize: 12, fontWeight: "700" },
  cameraButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 46,
    borderRadius: 12,
    marginTop: 12,
    backgroundColor: NAVY,
  },
  cameraButtonText: { color: WHITE, fontSize: 14, fontWeight: "900", letterSpacing: 0.2 },
  pressedDim: { opacity: 0.85 },
});
