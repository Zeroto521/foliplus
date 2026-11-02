import * as CONST from "../const.js";
import { MeasureMode, PreviewMode } from "./base.js";
import { CircleMode } from "./circle.js";
import { DistanceMode } from "./distance.js";
import { MarkerMode } from "./marker.js";
import { PolygonMode } from "./polygon.js";

const MODE_MAP = {
  [CONST.MEASURE_MODE.MARKER]: MarkerMode,
  [CONST.MEASURE_MODE.DISTANCE]: DistanceMode,
  [CONST.MEASURE_MODE.POLYGON]: PolygonMode,
  [CONST.MEASURE_MODE.CIRCLE]: CircleMode,
};

export {
  MODE_MAP,
  CircleMode,
  DistanceMode,
  MarkerMode,
  MeasureMode,
  PolygonMode,
  PreviewMode,
};
