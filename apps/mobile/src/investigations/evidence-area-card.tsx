import { theme } from "@inspection/theme/tokens";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import type { InvestigationEvidence } from "@inspection/domain/inspection/mobile";
import { visibleEvidencePage } from "./evidence-area-list";

export type EvidenceAreaPreview = Readonly<{
  fileUri?: string;
  textExcerpt?: string;
}>;

export function EvidenceAreaCard(props: {
  readonly areaLabel: (areaId: string) => string;
  readonly areas: readonly { readonly id: string; readonly label: string }[];
  readonly busy: boolean;
  readonly evidence: readonly InvestigationEvidence[];
  readonly onAssign: (artifactId: string, areaId: string) => void;
  readonly onClose: () => void;
  readonly previewFor: (artifactId: string) => EvidenceAreaPreview | undefined;
}) {
  const [visibleCount, setVisibleCount] = useState(5);
  const [choosingFor, setChoosingFor] = useState<string>();
  const [playingArtifactId, setPlayingArtifactId] = useState<string>();
  const player = useRef<AudioPlayer | undefined>(undefined);
  const visible = visibleEvidencePage(props.evidence, visibleCount);
  const remaining = Math.max(0, props.evidence.length - visible.length);
  useEffect(
    () => () => {
      player.current?.release();
    },
    [],
  );

  function toggleVoicePreview(artifactId: string, fileUri: string): void {
    if (playingArtifactId === artifactId) {
      player.current?.pause();
      setPlayingArtifactId(undefined);
      return;
    }
    player.current?.release();
    const next = createAudioPlayer(fileUri);
    player.current = next;
    next.play();
    setPlayingArtifactId(artifactId);
  }
  return (
    <View accessibilityLabel="Investigation evidence areas" style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        Evidence areas
      </Text>
      <Text style={styles.body}>
        Original capture areas remain immutable. Correcting an assignment adds
        visible history to the investigation.
      </Text>
      {visible.length === 0 ? (
        <Text style={styles.metadata}>No evidence is attached yet.</Text>
      ) : null}
      {visible.map((evidence) => {
        const preview = props.previewFor(evidence.artifactId);
        return (
          <View key={evidence.artifactId} style={styles.item}>
            <Text style={styles.itemTitle}>
              {evidence.artifactKind.replaceAll("_", " ")} · capture{" "}
              {evidence.captureSequence}
            </Text>
            <Text style={styles.metadata}>
              Captured in {props.areaLabel(evidence.captureAreaId)}
            </Text>
            <Text style={styles.metadata}>
              Assigned to {props.areaLabel(evidence.currentAreaId)}
            </Text>
            <Text style={styles.metadata}>
              Captured {new Date(evidence.capturedAt).toLocaleString()}
            </Text>
            {evidence.artifactKind === "photo" &&
            preview?.fileUri !== undefined ? (
              <Image
                accessibilityLabel={`Photo preview for capture ${evidence.captureSequence}`}
                resizeMode="cover"
                source={{ uri: preview.fileUri }}
                style={styles.photoPreview}
              />
            ) : evidence.artifactKind === "photo" ? (
              <Text style={styles.previewText}>
                Photo preview unavailable locally — use capture sequence and
                time, or restore the original before correcting its area.
              </Text>
            ) : null}
            {evidence.artifactKind === "voice_note" ? (
              <View style={styles.previewPanel}>
                <Text style={styles.previewText}>
                  {preview?.textExcerpt ??
                    "Transcript not available yet — play the original voice note to identify it."}
                </Text>
                {preview?.fileUri === undefined ? null : (
                  <Pressable
                    accessibilityHint="Plays or pauses this locally stored original voice note"
                    accessibilityRole="button"
                    onPress={() =>
                      toggleVoicePreview(evidence.artifactId, preview.fileUri!)
                    }
                    style={({ pressed }) => [
                      styles.action,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.actionLabel}>
                      {playingArtifactId === evidence.artifactId
                        ? "Pause voice note"
                        : "Play voice note"}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : null}
            {evidence.artifactKind === "manual_note" &&
            preview?.textExcerpt !== undefined ? (
              <Text style={styles.previewText}>{preview.textExcerpt}</Text>
            ) : null}
            {choosingFor === evidence.artifactId ? (
              <View style={styles.areaChoices}>
                {props.areas
                  .filter((area) => area.id !== evidence.currentAreaId)
                  .map((area) => (
                    <Pressable
                      accessibilityHint="Adds an inspector correction without changing the original capture area or current inspection location"
                      accessibilityRole="button"
                      disabled={props.busy}
                      key={area.id}
                      onPress={() => {
                        setChoosingFor(undefined);
                        props.onAssign(evidence.artifactId, area.id);
                      }}
                      style={({ pressed }) => [
                        styles.action,
                        props.busy && styles.disabled,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.actionLabel}>
                        Assign to {area.label}
                      </Text>
                    </Pressable>
                  ))}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setChoosingFor(undefined)}
                  style={({ pressed }) => [
                    styles.action,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.actionLabel}>Cancel area correction</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                accessibilityHint="Choose a corrected area without moving the active inspection location"
                accessibilityRole="button"
                disabled={props.busy}
                onPress={() => setChoosingFor(evidence.artifactId)}
                style={({ pressed }) => [
                  styles.action,
                  props.busy && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.actionLabel}>Correct assigned area</Text>
              </Pressable>
            )}
          </View>
        );
      })}
      {remaining > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setVisibleCount((current) => current + 5)}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.actionLabel}>
            Show older evidence ({remaining} remaining)
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={props.onClose}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Text style={styles.actionLabel}>Close evidence areas</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.large,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: theme.target.minimum,
    padding: theme.space[3],
  },
  actionLabel: {
    color: theme.color.ink,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  areaChoices: { gap: theme.space[2] },
  body: { color: theme.color.inkMuted, fontSize: 16, lineHeight: 25 },
  card: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.outline,
    borderRadius: theme.radius.medium,
    borderWidth: 1,
    gap: theme.space[3],
    marginTop: theme.space[4],
    padding: theme.space[4],
  },
  disabled: { opacity: 0.55 },
  item: {
    backgroundColor: theme.color.canvas,
    borderRadius: theme.radius.medium,
    gap: theme.space[1],
    padding: theme.space[3],
  },
  itemTitle: {
    color: theme.color.ink,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  metadata: { color: theme.color.inkMuted, fontSize: 14, lineHeight: 21 },
  photoPreview: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.medium,
    height: 144,
    marginTop: theme.space[2],
    width: "100%",
  },
  pressed: { opacity: 0.82 },
  previewPanel: { gap: theme.space[2], marginTop: theme.space[2] },
  previewText: { color: theme.color.ink, fontSize: 15, lineHeight: 22 },
  title: {
    color: theme.color.ink,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 26,
  },
});
