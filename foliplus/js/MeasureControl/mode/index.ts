import * as CONST from "./../const.js";
import { MeasureMode, PreviewMode } from "./base.js";
import { MarkerMode } from "./marker.js";
import { DistanceMode } from "./distance.js";
import { PolygonMode } from "./polygon.js";
import { CircleMode } from "./circle.js";

export const MODE_MAP = {
  [CONST.MODE.MARKER]: MarkerMode,
  [CONST.MODE.DISTANCE]: DistanceMode,
  [CONST.MODE.POLYGON]: PolygonMode,
  [CONST.MODE.CIRCLE]: CircleMode,
};

export {
  CircleMode,
  DistanceMode,
  MarkerMode,
  MeasureMode,
  PolygonMode,
  PreviewMode,
};
