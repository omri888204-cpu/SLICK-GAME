from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src" / "assets" / "sprites" / "chameleon-black-directions.png"
OUTPUT = ROOT / "src" / "assets" / "sprites" / "chameleon_clean.png"


def largest_foreground_mask(image_bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]

    # The new source has a solid black background. Seed the character from
    # colored/bright pixels, then close/dilate to preserve dark details inside.
    colored = (((saturation > 30) & (value > 24)) | ((saturation > 18) & (value > 92))).astype(
        np.uint8
    )
    height, width = colored.shape
    component_count, labels, stats, _ = cv2.connectedComponentsWithStats(colored, connectivity=8)

    mask = np.zeros(colored.shape, dtype=np.uint8)
    for label in range(1, component_count):
        x, y, w, h, area = stats[label]
        if area < 5_000:
            continue

        # Reject watermark/edge artifacts, keep the two chameleon bodies.
        if w > width * 0.65 or h > height * 0.9:
            continue

        mask[labels == label] = 255

    mask = cv2.morphologyEx(
        mask,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)),
        iterations=2,
    )
    mask = cv2.dilate(
        mask,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
        iterations=1,
    )

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(mask)
    for contour in contours:
        if cv2.contourArea(contour) > 5_000:
            cv2.drawContours(filled, [contour], -1, 255, thickness=cv2.FILLED)

    return filled


def black_edge_mask(image_bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]

    # Mostly removes black fringe close to the source background before alpha is applied.
    mask = ((saturation < 42) & (value < 34)).astype(np.uint8) * 255

    mask = cv2.morphologyEx(
        mask,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)),
    )
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    return mask


def soften_alpha(alpha: np.ndarray) -> np.ndarray:
    eroded = cv2.erode(alpha, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    blurred = cv2.GaussianBlur(eroded, (0, 0), sigmaX=0.55, sigmaY=0.55)
    return blurred


def trim_outer_black_only(image_bgr: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]

    # Only remove almost-black low-saturation pixels. This preserves the
    # chameleon's dark painted details now that the game background is black.
    dark_background_like = ((value < 12) & (saturation < 44)).astype(np.uint8) * 255

    cleaned = alpha.copy()
    cleaned[dark_background_like > 0] = 0
    return cleaned


def main() -> None:
    image = cv2.imread(str(SOURCE), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(SOURCE)

    mask = black_edge_mask(image)
    inpainted = cv2.inpaint(image, mask, 5, cv2.INPAINT_TELEA)

    alpha = largest_foreground_mask(image)
    alpha = trim_outer_black_only(image, alpha)
    alpha = soften_alpha(alpha)

    result = cv2.cvtColor(inpainted, cv2.COLOR_BGR2BGRA)
    result[:, :, 3] = alpha

    if not cv2.imwrite(str(OUTPUT), result):
        raise RuntimeError(f"Failed to write {OUTPUT}")

    remaining_dark = int(np.count_nonzero((mask > 0) & (alpha > 0)))
    total_foreground = int(np.count_nonzero(alpha > 0))
    transparent = int(np.count_nonzero(alpha == 0))
    print(f"wrote={OUTPUT}")
    print(f"foreground_pixels={total_foreground}")
    print(f"transparent_pixels={transparent}")
    print(f"inpainted_dark_pixels_inside_alpha={remaining_dark}")


if __name__ == "__main__":
    main()
