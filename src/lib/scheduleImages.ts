// 카메라/앨범에서 일정표 사진을 고르고, 서버로 보낼 크기로 줄여 base64로 만든다.

import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import type { ScheduleImagePayload } from "../api/parseScheduleImage";

/** 한 번에 보낼 수 있는 사진 수(서버 MAX_SCHEDULE_IMAGES와 같은 값). */
export const MAX_SCHEDULE_IMAGES = 5;

// 폰 카메라 원본(4000px, 3~8MB)은 그대로 보내면 요청이 무겁고, Claude도 긴 변 2576px로 줄여 읽는다.
// 긴 변 2000px이면 표의 작은 글씨도 읽히면서 토큰(≈비용)은 원본의 절반 이하다.
const MAX_LONG_EDGE = 2000;
const JPEG_QUALITY = 0.85;

export type PickedImage = {
  /** 미리보기용 로컬 파일 URI(줄인 뒤의 파일). */
  uri: string;
  width: number;
  height: number;
  payload: ScheduleImagePayload;
};

export class PermissionDeniedError extends Error {
  constructor(what: "camera" | "library") {
    super(what === "camera" ? "카메라 권한이 없습니다. 설정에서 허용해 주세요." : "사진 접근 권한이 없습니다. 설정에서 허용해 주세요.");
    this.name = "PermissionDeniedError";
  }
}

/** 카메라로 한 장 찍거나 앨범에서 여러 장 고른다. 취소하면 빈 배열. */
export async function pickScheduleImages(source: "camera" | "library", remaining: number): Promise<PickedImage[]> {
  let result: ImagePicker.ImagePickerResult;
  if (source === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new PermissionDeniedError("camera");
    result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
  } else {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new PermissionDeniedError("library");
    result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsMultipleSelection: remaining > 1,
      selectionLimit: Math.max(1, remaining),
    });
  }
  if (result.canceled) return [];

  const picked: PickedImage[] = [];
  for (const asset of result.assets.slice(0, remaining)) {
    picked.push(await shrinkForUpload(asset.uri, asset.width, asset.height));
  }
  return picked;
}

async function shrinkForUpload(uri: string, width: number, height: number): Promise<PickedImage> {
  const context = ImageManipulator.manipulate(uri);
  const longEdge = Math.max(width, height);
  if (longEdge > MAX_LONG_EDGE) {
    // 한 변만 주면 비율은 유지된다.
    context.resize(width >= height ? { width: MAX_LONG_EDGE, height: null } : { width: null, height: MAX_LONG_EDGE });
  }
  const image = await context.renderAsync();
  try {
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY, base64: true });
    if (!saved.base64) throw new Error("사진을 변환하지 못했습니다.");
    return {
      uri: saved.uri,
      width: saved.width,
      height: saved.height,
      payload: { data: saved.base64, mediaType: "image/jpeg" },
    };
  } finally {
    image.release();
  }
}
