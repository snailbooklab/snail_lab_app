const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("expo/config-plugins");

/**
 * react-native-android-widget는 appwidget-provider XML에 android:widgetCategory="home_screen"을
 * 하드코딩하고, 이를 바꿀 설정 옵션을 제공하지 않는다.
 *
 * 삼성 One UI처럼 자체 잠금화면 위젯 목록을 쓰는 런처는 keyguard 카테고리를 선언한 위젯만
 * 후보로 노출하는 경우가 있어, "home_screen|keyguard"로 바꿔 양쪽 모두에 뜨게 한다.
 * home_screen이 그대로 남아 있으므로 홈화면 배치는 영향받지 않는다.
 *
 * (keyguard 카테고리는 API 21에서 deprecated 됐지만 무시될 뿐 부작용은 없다.)
 *
 * ⚠️ app.json의 plugins 배열에서 반드시 "react-native-android-widget"보다 **앞에** 둬야 한다.
 * withDangerousMod는 나중에 적용된 것이 먼저 실행되므로, 뒤에 두면 XML이 생성되기 전에 돌아
 * 패치 대상을 찾지 못한다.
 */
module.exports = function withLockScreenWidgetCategory(config) {
  return withDangerousMod(config, [
    "android",
    (dangerousConfig) => {
      const patched = findWidgetProviderXml(dangerousConfig.modRequest.platformProjectRoot).filter(
        (file) => {
          const before = fs.readFileSync(file, "utf8");
          const after = before.replace(
            /android:widgetCategory="home_screen"/g,
            'android:widgetCategory="home_screen|keyguard"',
          );
          if (before === after) return false;
          fs.writeFileSync(file, after);
          return true;
        },
      );

      if (patched.length === 0) {
        // 조용히 넘어가면 "왜 잠금화면 목록에 안 뜨지?"를 나중에 추적하기 어렵다.
        console.warn(
          "[withLockScreenWidgetCategory] 패치할 widgetprovider XML을 찾지 못했습니다 — " +
            "react-native-android-widget 플러그인보다 먼저 실행됐거나 XML 형식이 바뀌었을 수 있습니다.",
        );
      }

      return dangerousConfig;
    },
  ]);
};

/** platformProjectRoot 아래에서 widgetprovider_*.xml을 전부 찾는다.
 *  라이브러리가 파일을 쓰는 위치가 버전에 따라 달라져도 견디도록 경로를 고정하지 않고 훑는다. */
function findWidgetProviderXml(root) {
  const found = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "build" || entry.name === "node_modules" || entry.name === ".gradle") continue;
        walk(full);
      } else if (/^widgetprovider_.*\.xml$/.test(entry.name)) {
        found.push(full);
      }
    }
  }

  walk(root);
  return found;
}
