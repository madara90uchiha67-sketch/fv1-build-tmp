import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import type { VoicePhase } from "../lib/realtime-events";
import { colors, sz } from "../theme";

// Esfera propia de Founder: un núcleo sólido con tres anillos concéntricos que respiran y laten con la voz.
// Escuchando: respira despacio · tú hablando: los anillos se abren con tu voz · pensando: tres puntos giran alrededor ·
// Founder habla: los anillos laten con su ritmo y salen ondas hacia afuera. Usa solo los colores del tema.

const SIZE = sz(190);
const BOX = SIZE * 1.9;

const loop = (v: Animated.Value, duration: number, easing = Easing.linear, delay = 0) =>
  Animated.loop(Animated.sequence([Animated.delay(delay), Animated.timing(v, { toValue: 1, duration, easing, useNativeDriver: true }), Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true })]));

export function FounderOrb({ phase, mic, out }: { phase: VoicePhase; mic: number; out: number }) {
  const breath = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const waveA = useRef(new Animated.Value(0)).current;
  const waveB = useRef(new Animated.Value(0)).current;
  const level = useRef(new Animated.Value(0)).current;
  const dots = useRef(new Animated.Value(0)).current;
  const wavesOn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anims = [
      Animated.loop(Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])),
      loop(spin, 1700),
      loop(waveA, 1800, Easing.out(Easing.quad)),
      loop(waveB, 1800, Easing.out(Easing.quad), 900),
    ];
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [breath, spin, waveA, waveB]);

  useEffect(() => {
    const speaking = phase === "speaking" || phase === "user_speaking";
    Animated.parallel([
      Animated.timing(wavesOn, { toValue: phase === "speaking" ? 1 : 0, duration: 300, useNativeDriver: true }),
      Animated.timing(dots, { toValue: phase === "thinking" ? 1 : 0, duration: 300, useNativeDriver: true }),
    ]).start();
    const value = phase === "speaking" ? out : speaking ? mic : 0;
    Animated.timing(level, { toValue: Math.min(1, value * 3), duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [phase, mic, out, level, wavesOn, dots]);

  const core = Animated.add(breath.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.03] }), level.interpolate({ inputRange: [0, 1], outputRange: [0, 0.08] }));
  const ring1 = Animated.add(breath.interpolate({ inputRange: [0, 1], outputRange: [1.12, 1.2] }), level.interpolate({ inputRange: [0, 1], outputRange: [0, 0.16] }));
  const ring2 = Animated.add(breath.interpolate({ inputRange: [0, 1], outputRange: [1.3, 1.4] }), level.interpolate({ inputRange: [0, 1], outputRange: [0, 0.26] }));
  const wave = (v: Animated.Value) => ({
    opacity: Animated.multiply(wavesOn, v.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.4, 0] })),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1.1, 1.75] }) }],
  });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <View style={{ width: BOX, height: BOX, alignItems: "center", justifyContent: "center" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.circle, styles.wave, wave(waveA)]} />
      <Animated.View style={[styles.circle, styles.wave, wave(waveB)]} />
      <Animated.View style={[styles.circle, { opacity: 0.07, backgroundColor: colors.text, transform: [{ scale: ring2 }] }]} />
      <Animated.View style={[styles.circle, { opacity: 0.14, backgroundColor: colors.text, transform: [{ scale: ring1 }] }]} />
      <Animated.View style={[styles.circle, { backgroundColor: colors.text, transform: [{ scale: core }] }]} />
      <Animated.View style={[styles.orbit, { opacity: dots, transform: [{ rotate }] }]}>
        {[0, 1, 2].map((i) => <View key={i} style={[styles.dot, { transform: [{ rotate: `${i * 120}deg` }, { translateY: -SIZE * 0.78 }] }]} />)}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { position: "absolute", width: SIZE, height: SIZE, borderRadius: SIZE },
  wave: { backgroundColor: "transparent", borderWidth: 2, borderColor: colors.text },
  orbit: { position: "absolute", width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", width: sz(10), height: sz(10), borderRadius: sz(5), backgroundColor: colors.text },
});
