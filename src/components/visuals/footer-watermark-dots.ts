// Roughly one dot in six flips to the other state, the speckle the brand's dot shader gives its imagery.
const SPECKLE_RATE = 0.16;

function isSpeckled(column: number, row: number) {
  const hash = Math.sin(column * 12.9898 + row * 78.233) * 43758.5453;
  return hash - Math.floor(hash) < SPECKLE_RATE;
}

/** Mostly rings or mostly solid dots, with the shader speckle flipping a few. */
const isFilledAmongRings = isSpeckled;
const isFilledAmongSolids = (column: number, row: number) => !isSpeckled(column, row);

const SAMPLES_PER_CELL = 6;
const MIN_COVERAGE = 0.3;
const RADIUS_RATIO = 0.37;
const RING_STROKE_RATIO = 0.17;
// A ring this much smaller than its cell closes up into a smudge, so it is drawn as a solid speck instead.
const SMALLEST_RING_SCALE = 0.8;
const SPECK_SCALE = 0.55;

export interface DotLayer {
  rings: string;
  solids: string;
}

export interface WatermarkDots {
  ringStroke: number;
  resting: DotLayer;
  swapped: DotLayer;
}

export interface WatermarkPart {
  firstCharacter: number;
  characterCount: number;
  isMostlySolid: boolean;
}

interface InkCell {
  column: number;
  row: number;
  /** Share of the cell the letter covers, which sets how large its dot is. */
  coverage: number;
}

interface Size {
  width: number;
  height: number;
}

const rounded = (value: number) => Math.round(value * 1000) / 1000;

const circlePath = (x: number, y: number, radius: number) =>
  `M${rounded(x - radius)} ${rounded(y)}a${rounded(radius)} ${rounded(radius)} 0 1 0 ${rounded(radius * 2)} 0a${rounded(radius)} ${rounded(radius)} 0 1 0 ${rounded(-radius * 2)} 0`;

// Characters are placed where the SVG laid them out, so the dots follow its kerning and tracking rather than the canvas's.
function inkCells(text: SVGTextElement, { firstCharacter, characterCount }: WatermarkPart, pitch: number, { width, height }: Size): InkCell[] {
  const columns = Math.ceil(width / pitch);
  const rows = Math.ceil(height / pitch);
  const canvas = document.createElement("canvas");
  canvas.width = columns * SAMPLES_PER_CELL;
  canvas.height = rows * SAMPLES_PER_CELL;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];

  const samplesPerUnit = SAMPLES_PER_CELL / pitch;
  const style = getComputedStyle(text);
  context.font = `${style.fontStyle} ${style.fontWeight} ${parseFloat(style.fontSize) * samplesPerUnit}px ${style.fontFamily}`;
  const characters = text.textContent ?? "";
  for (let index = firstCharacter; index < firstCharacter + characterCount; index++) {
    const { x, y } = text.getStartPositionOfChar(index);
    context.fillText(characters[index], x * samplesPerUnit, y * samplesPerUnit);
  }

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const samplesInCell = SAMPLES_PER_CELL * SAMPLES_PER_CELL;
  const cells: InkCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      let alpha = 0;
      for (let sampleRow = 0; sampleRow < SAMPLES_PER_CELL; sampleRow++) {
        const rowStart = ((row * SAMPLES_PER_CELL + sampleRow) * canvas.width + column * SAMPLES_PER_CELL) * 4;
        for (let sampleColumn = 0; sampleColumn < SAMPLES_PER_CELL; sampleColumn++) alpha += data[rowStart + sampleColumn * 4 + 3];
      }
      const coverage = alpha / (255 * samplesInCell);
      if (coverage >= MIN_COVERAGE) cells.push({ column, row, coverage });
    }
  }
  return cells;
}

/**
 * The wordmark rebuilt from the brand's circles: each part mostly rings or mostly solid dots, sized by how much of the
 * letter falls in the cell. The swapped layer trades the two, for the patch under the pointer.
 */
export function sampleWatermarkDots(text: SVGTextElement, parts: WatermarkPart[], pitch: number, size: Size): WatermarkDots {
  const ringStroke = rounded(pitch * RING_STROKE_RATIO);
  const resting = { rings: "", solids: "" };
  const swapped = { rings: "", solids: "" };

  const place = (layer: DotLayer, { column, row, coverage }: InkCell, isFilled: boolean) => {
    const x = (column + 0.5) * pitch;
    const y = (row + 0.5) * pitch;
    const scale = Math.sqrt(Math.min(1, coverage));
    const radius = pitch * RADIUS_RATIO * scale;
    if (isFilled) layer.solids += circlePath(x, y, radius);
    else if (scale < SMALLEST_RING_SCALE) layer.solids += circlePath(x, y, radius * SPECK_SCALE);
    else layer.rings += circlePath(x, y, radius - ringStroke / 2);
  };

  for (const part of parts) {
    const isFilledAtRest = part.isMostlySolid ? isFilledAmongSolids : isFilledAmongRings;
    for (const cell of inkCells(text, part, pitch, size)) {
      const isFilled = isFilledAtRest(cell.column, cell.row);
      place(resting, cell, isFilled);
      place(swapped, cell, !isFilled);
    }
  }
  return { ringStroke, resting, swapped };
}
