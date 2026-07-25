import { useCallback, useEffect, useRef } from "react";
import { FlatList, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

const ITEM_HEIGHT = 40;
const VISIBLE_COUNT = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_COUNT;

export type WheelItem<T> = { label: string; value: T };

/** 가운데 값만 진하게 강조되는 세로 휠 피커 — 스크롤해서 값을 고른다. */
export default function WheelPicker<T extends string | number>({
  items,
  selectedValue,
  onChange,
}: {
  items: WheelItem<T>[];
  selectedValue: T;
  onChange: (value: T) => void;
}) {
  const listRef = useRef<FlatList<WheelItem<T>>>(null);
  const selectedIndex = Math.max(
    0,
    items.findIndex((it) => it.value === selectedValue),
  );

  const commitAtOffset = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
      const clamped = Math.min(Math.max(index, 0), items.length - 1);
      const item = items[clamped];
      if (item && item.value !== selectedValue) onChange(item.value);
    },
    [items, selectedValue, onChange],
  );

  // 값이 밖에서 바뀌면(예: 오전/오후 전환) 휠도 그 위치로 맞춰 스크롤한다 — 안 그러면 굵은
  // 강조와 실제 스크롤 위치가 어긋난다. 사용자가 스크롤로 방금 바꾼 경우엔 이미 그 위치라
  // scrollToIndex가 사실상 no-op이므로 피드백 루프가 생기지 않는다.
  useEffect(() => {
    listRef.current?.scrollToIndex({ index: selectedIndex, animated: true });
  }, [selectedIndex]);

  return (
    <View style={styles.wheel}>
      <View pointerEvents="none" style={styles.centerHighlight} />
      <FlatList
        ref={listRef}
        data={items}
        extraData={selectedValue}
        keyExtractor={(it) => String(it.value)}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        getItemLayout={(_, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
        initialScrollIndex={selectedIndex}
        onScrollToIndexFailed={() => {}}
        contentContainerStyle={{ paddingVertical: (WHEEL_HEIGHT - ITEM_HEIGHT) / 2 }}
        // 느리게 끌어서 관성 없이 놓으면 onMomentumScrollEnd가 안 오는 경우가 있어 둘 다 건다.
        onMomentumScrollEnd={commitAtOffset}
        onScrollEndDrag={commitAtOffset}
        renderItem={({ item }) => {
          const active = item.value === selectedValue;
          return (
            <View style={styles.item}>
              <Text style={[styles.itemText, active && styles.itemTextActive]}>{item.label}</Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wheel: { height: WHEEL_HEIGHT, flex: 1, overflow: "hidden" },
  centerHighlight: {
    position: "absolute",
    left: 4,
    right: 4,
    top: (WHEEL_HEIGHT - ITEM_HEIGHT) / 2,
    height: ITEM_HEIGHT,
    backgroundColor: "#f6e9d1",
    borderRadius: 10,
  },
  item: { height: ITEM_HEIGHT, alignItems: "center", justifyContent: "center" },
  itemText: { fontSize: 16, color: "#b7ab94", fontWeight: "500" },
  itemTextActive: { fontSize: 19, color: "#1f1b16", fontWeight: "700" },
});
