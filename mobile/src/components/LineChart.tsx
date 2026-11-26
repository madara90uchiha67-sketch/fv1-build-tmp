import { useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { colors } from "../theme";

// Gráfica de línea con la misma geometría que las gráficas SVG de Founder Web (viewBox 100×90):
// 4 líneas de guía punteadas (y = 20, 42, 64, 84), trazo de 1,7 y punto final. Se dibuja con vistas
// nativas y toma el ancho/alto reales del contenedor, así que nunca se desborda de la tarjeta.
const VIEW_H = 90;
const GRID_Y = [20, 42, 64, 84];

export function LineChart({ values, label }: { values: number[]; label: string }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - size.w) > 0.5 || Math.abs(height - size.h) > 0.5) setSize({ w: width, h: height });
  };
  const { w, h } = size;
  const max = Math.max(...values, 1);
  const yOf = (v: number) => ((80 - (v / max) * 64) / VIEW_H) * h;
  const xOf = (i: number) => (values.length < 2 ? 0.5 : i / (values.length - 1)) * w;

  return (
    <View style={{ flex: 1, minHeight: 0 }} onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={label}>
      {w > 0 && h > 0 ? (
        <>
          {GRID_Y.map((y) => (
            <View key={y} style={{ position: "absolute", left: 0, right: 0, top: (y / VIEW_H) * h, borderTopWidth: 1, borderStyle: "dashed", borderColor: colors.grid }} />
          ))}
          {values.length > 1
            ? values.slice(0, -1).map((v, i) => {
                const x1 = xOf(i), y1 = yOf(v), x2 = xOf(i + 1), y2 = yOf(values[i + 1]);
                const len = Math.hypot(x2 - x1, y2 - y1);
                const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
                return <View key={i} style={{ position: "absolute", left: x1, top: y1 - 0.85, width: len, height: 1.7, borderRadius: 1, backgroundColor: colors.coral, transformOrigin: "left center", transform: [{ rotate: `${angle}deg` }] }} />;
              })
            : null}
          {values.length > 0 ? <View style={{ position: "absolute", left: Math.min(Math.max(xOf(values.length - 1) - 3, 0), w - 6), top: yOf(values[values.length - 1]) - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.coral }} /> : null}
        </>
      ) : null}
    </View>
  );
}
