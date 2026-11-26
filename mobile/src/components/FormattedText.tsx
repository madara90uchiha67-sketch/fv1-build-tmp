import { Fragment } from "react";
import { Text, View } from "react-native";
import { MAX_FONT_SCALE, colors, spacing, typography } from "../theme";

// Las respuestas de Founder llegan con Markdown ligero. Aquí se interpretan solo los elementos básicos
// (negritas, encabezados y viñetas) para que se lean bien; el resto se muestra como texto.
function renderInline(line: string, keyPrefix: string) {
  const parts = line.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} key={`${keyPrefix}-${index}`} style={{ fontFamily: typography.bodyStrong.fontFamily }}>
        {part}
      </Text>
    ) : (
      <Fragment key={`${keyPrefix}-${index}`}>{part}</Fragment>
    ),
  );
}

export function FormattedText({ text, color = colors.text }: { text: string; color?: string }) {
  const lines = text.split("\n");
  return (
    <View>
      {lines.map((raw, index) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <View key={index} style={{ height: spacing.sm }} />;
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
        const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
        const style = { ...typography.body, color };
        if (heading) {
          return (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} key={index} style={[style, { fontFamily: typography.heading.fontFamily, marginTop: spacing.sm }]}>
              {renderInline(heading[1], String(index))}
            </Text>
          );
        }
        if (bullet || numbered) {
          const marker = bullet ? "•" : `${numbered![1]}.`;
          const content = bullet ? bullet[1] : numbered![2];
          return (
            <View key={index} style={{ flexDirection: "row" }}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[style, { width: 24 }]}>{marker}</Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[style, { flex: 1 }]}>{renderInline(content, String(index))}</Text>
            </View>
          );
        }
        return (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} key={index} style={style}>
            {renderInline(line, String(index))}
          </Text>
        );
      })}
    </View>
  );
}
