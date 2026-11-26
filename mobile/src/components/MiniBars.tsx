import { View } from "react-native";
import { colors, radius } from "../theme";

// Barras de ventas por día. Recibe valores ya calculados a partir de datos reales; no genera datos.
export function MiniBars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(...values, 0);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ flexDirection: "row", alignItems: "flex-end", height: 64, gap: 2 }}
    >
      {values.map((value, index) => {
        const height = max > 0 && value > 0 ? Math.max(4, (value / max) * 64) : 2;
        const isLast = index === values.length - 1;
        return (
          <View
            key={index}
            style={{
              flex: 1,
              height,
              borderRadius: radius.sm / 4,
              backgroundColor: value > 0 ? (isLast ? colors.coral : colors.lineStrong) : colors.line,
            }}
          />
        );
      })}
    </View>
  );
}
