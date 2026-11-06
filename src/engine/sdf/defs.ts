/* Generated from Material Maker's sdf_builder/*.gd get_parameter_defs() (MIT). Keyed by script path. */
import type { ParameterDef } from "../gen/base";

export const SDF_PARAMETER_DEFS: Record<string, ParameterDef[]> = {
 "sdf2d/alter/annular": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  },
  {
   "label": "Width",
   "name": "width",
   "type": "float",
   "min": 0.0,
   "max": 0.5,
   "step": 0.01,
   "default": 0.1,
   "control": "Scale1.r"
  }
 ],
 "sdf2d/alter/bend": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  },
  {
   "label": "Amount",
   "name": "amount",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  }
 ],
 "sdf2d/alter/color": [
  {
   "label": "Local",
   "name": "local",
   "type": "boolean",
   "default": false
  }
 ],
 "sdf2d/alter/elongate": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  },
  {
   "label": "Size.x",
   "name": "size_x",
   "type": "float",
   "min": 0.0,
   "max": 0.5,
   "step": 0.01,
   "default": 0.1,
   "control": "Rect1.x"
  },
  {
   "label": "Size.y",
   "name": "size_y",
   "type": "float",
   "min": 0.0,
   "max": 0.5,
   "step": 0.01,
   "default": 0.1,
   "control": "Rect1.y"
  }
 ],
 "sdf2d/alter/flip": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  },
  {
   "label": "H",
   "name": "h_flip",
   "type": "boolean",
   "default": true
  },
  {
   "label": "V",
   "name": "v_flip",
   "type": "boolean",
   "default": true
  }
 ],
 "sdf2d/alter/mirror": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  },
  {
   "label": "H",
   "name": "h_mirror",
   "type": "boolean",
   "default": true
  },
  {
   "label": "V",
   "name": "v_mirror",
   "type": "boolean",
   "default": true
  }
 ],
 "sdf2d/alter/morph": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  },
  {
   "label": "K",
   "name": "k",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  }
 ],
 "sdf2d/alter/round": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  },
  {
   "label": "Width",
   "name": "width",
   "type": "float",
   "min": 0.0,
   "max": 0.5,
   "step": 0.01,
   "default": 0.1,
   "control": "Scale1.r"
  }
 ],
 "sdf2d/boolean/difference": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  }
 ],
 "sdf2d/boolean/intersection": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  }
 ],
 "sdf2d/boolean/union": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  }
 ],
 "sdf2d/shapes/arc": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Angle 1",
   "name": "a1",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 1.0,
   "default": 50.0,
   "control": "Angle1.a"
  },
  {
   "label": "Angle 2",
   "name": "a2",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 1.0,
   "default": -90.0,
   "control": "Angle2.a"
  },
  {
   "label": "Radius",
   "name": "r1",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.4,
   "control": "Radius1.r"
  },
  {
   "label": "Width",
   "name": "r2",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.1,
   "control": "Radius11.r"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  }
 ],
 "sdf2d/shapes/arrow": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "A X",
   "name": "ax",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": -0.3,
   "control": "P11.x"
  },
  {
   "label": "A Y",
   "name": "ay",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": -0.3,
   "control": "P11.y"
  },
  {
   "label": "B X",
   "name": "bx",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.3,
   "control": "P12.x"
  },
  {
   "label": "B Y",
   "name": "by",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.3,
   "control": "P12.y"
  },
  {
   "label": "Ratio",
   "name": "k",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.55,
   "control": "None"
  },
  {
   "label": "Head",
   "name": "wh",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.25,
   "control": "None"
  },
  {
   "label": "Tail",
   "name": "wt",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.1,
   "control": "None"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  }
 ],
 "sdf2d/shapes/box": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  },
  {
   "label": "Size.x",
   "name": "size_x",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5,
   "control": "Rect1.x"
  },
  {
   "label": "Size.y",
   "name": "size_y",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5,
   "control": "Rect1.y"
  }
 ],
 "sdf2d/shapes/circle": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  },
  {
   "label": "Radius",
   "name": "radius",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  }
 ],
 "sdf2d/shapes/cross": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Radius",
   "name": "r",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.15,
   "control": "Radius1.r"
  },
  {
   "label": "Width",
   "name": "bx",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5,
   "control": "Rect1.x"
  },
  {
   "label": "Height",
   "name": "by",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.15,
   "control": "Rect1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  }
 ],
 "sdf2d/shapes/heart": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.05,
   "control": "P1.y"
  },
  {
   "label": "Radius",
   "name": "r",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.45,
   "control": "Radius1.r"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  }
 ],
 "sdf2d/shapes/hexagram": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Radius",
   "name": "r",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.25,
   "control": "Radius1.r"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  }
 ],
 "sdf2d/shapes/line": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  },
  {
   "label": "A.x",
   "name": "ax",
   "type": "float",
   "min": -0.5,
   "max": 0.5,
   "step": 0.01,
   "default": -0.25,
   "control": "P11.x"
  },
  {
   "label": "A.y",
   "name": "ay",
   "type": "float",
   "min": -0.5,
   "max": 0.5,
   "step": 0.01,
   "default": -0.25,
   "control": "P11.y"
  },
  {
   "label": "B.x",
   "name": "bx",
   "type": "float",
   "min": -0.5,
   "max": 0.5,
   "step": 0.01,
   "default": 0.25,
   "control": "P12.x"
  },
  {
   "label": "B.y",
   "name": "by",
   "type": "float",
   "min": -0.5,
   "max": 0.5,
   "step": 0.01,
   "default": 0.25,
   "control": "P12.y"
  },
  {
   "label": "Radius",
   "name": "r",
   "type": "float",
   "min": -0.5,
   "max": 0.5,
   "step": 0.01,
   "default": 0.25,
   "control": "RadiusP11.r"
  }
 ],
 "sdf2d/shapes/moon": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Radius",
   "name": "ra",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5,
   "control": "Rect1.y"
  },
  {
   "label": "Inner Radius",
   "name": "rb",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5,
   "control": "Radius11.r"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Distance",
   "name": "d",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.4,
   "control": "None"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  }
 ],
 "sdf2d/shapes/ngon": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  },
  {
   "label": "N",
   "name": "edgecount",
   "type": "float",
   "min": 3.0,
   "max": 32.0,
   "step": 1.0,
   "default": 5
  },
  {
   "label": "Radius",
   "name": "radius",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  }
 ],
 "sdf2d/shapes/pie": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Radius",
   "name": "r",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5,
   "control": "Radius1.r"
  },
  {
   "label": "Aperture",
   "name": "aa",
   "type": "float",
   "min": -90.0,
   "max": 90.0,
   "step": 1.0,
   "default": -45,
   "control": "Radius1.a"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  }
 ],
 "sdf2d/shapes/polygon": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  },
  {
   "label": "Radius",
   "name": "radius",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  },
  {
   "label": "Points",
   "name": "polygon",
   "type": "polygon",
   "default": {
    "points": [
     {
      "x": 0.2,
      "y": 0.2
     },
     {
      "x": 0.4,
      "y": 0.7
     },
     {
      "x": 0.7,
      "y": 0.4
     }
    ],
    "type": "Polygon"
   }
  }
 ],
 "sdf2d/shapes/stairs": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  },
  {
   "label": "Size.x",
   "name": "size_x",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5,
   "control": "Rect1.x"
  },
  {
   "label": "Size.y",
   "name": "size_y",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5,
   "control": "Rect1.y"
  },
  {
   "label": "Steps",
   "name": "steps",
   "type": "float",
   "min": 1.0,
   "max": 16.0,
   "step": 1.0,
   "default": 3
  }
 ],
 "sdf2d/shapes/star": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  },
  {
   "label": "N",
   "name": "branchcount",
   "type": "float",
   "min": 3.0,
   "max": 32.0,
   "step": 1,
   "default": 5
  },
  {
   "label": "Radius",
   "name": "radius",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  },
  {
   "label": "Pointiness",
   "name": "pointiness",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  }
 ],
 "sdf2d/shapes/vesica": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Radius",
   "name": "r",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.6,
   "control": "Rect1.y"
  },
  {
   "label": "Distance",
   "name": "d",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.4,
   "control": "Rect1.x"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  }
 ],
 "sdf2d/smooth/smooth_union": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.x"
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0,
   "control": "P1.y"
  },
  {
   "label": "Rotation",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0,
   "control": "RotateScale1.a"
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0,
   "control": "RotateScale1.r"
  },
  {
   "label": "K",
   "name": "k",
   "type": "float",
   "min": 0.0,
   "max": 5.0,
   "step": 0.01,
   "default": 1.0,
   "control": "Scale1.r"
  },
  {
   "label": "ColorK",
   "name": "color_k",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  }
 ],
 "sdf3d/alter/annular": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  },
  {
   "label": "Width",
   "name": "width",
   "type": "float",
   "min": 0.0,
   "max": 0.5,
   "step": 0.01,
   "default": 0.1,
   "control": "Scale1.r"
  }
 ],
 "sdf3d/alter/bend": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  },
  {
   "label": "Amount",
   "name": "amount",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  }
 ],
 "sdf3d/alter/distort": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  },
  {
   "label": "Amount",
   "name": "amount",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.1
  }
 ],
 "sdf3d/alter/elongate": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  },
  {
   "label": "Size.x",
   "name": "size_x",
   "type": "float",
   "min": 0.0,
   "max": 0.5,
   "step": 0.01,
   "default": 0.1
  },
  {
   "label": "Size.y",
   "name": "size_y",
   "type": "float",
   "min": 0.0,
   "max": 0.5,
   "step": 0.01,
   "default": 0.1
  },
  {
   "label": "Size.z",
   "name": "size_z",
   "type": "float",
   "min": 0.0,
   "max": 0.5,
   "step": 0.01,
   "default": 0.1
  }
 ],
 "sdf3d/alter/flip": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  },
  {
   "label": "X",
   "name": "x_flip",
   "type": "boolean",
   "default": true
  },
  {
   "label": "Y",
   "name": "y_flip",
   "type": "boolean",
   "default": true
  },
  {
   "label": "Z",
   "name": "z_flip",
   "type": "boolean",
   "default": true
  }
 ],
 "sdf3d/alter/mirror": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  },
  {
   "label": "X",
   "name": "x_mirror",
   "type": "boolean",
   "default": true
  },
  {
   "label": "Y",
   "name": "y_mirror",
   "type": "boolean",
   "default": true
  },
  {
   "label": "Z",
   "name": "z_mirror",
   "type": "boolean",
   "default": true
  }
 ],
 "sdf3d/alter/morph": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  },
  {
   "label": "K",
   "name": "k",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  }
 ],
 "sdf3d/alter/round": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  },
  {
   "label": "Width",
   "name": "width",
   "type": "float",
   "min": 0.0,
   "max": 0.5,
   "step": 0.01,
   "default": 0.1
  }
 ],
 "sdf3d/alter/twist": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  },
  {
   "label": "Axis",
   "name": "axis",
   "type": "enum",
   "values": [
    {
     "name": "X",
     "value": "yz"
    },
    {
     "name": "Y",
     "value": "zx"
    },
    {
     "name": "Z",
     "value": "xy"
    }
   ],
   "default": 0
  },
  {
   "label": "Angle",
   "name": "angle",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.1,
   "default": 0.0
  }
 ],
 "sdf3d/boolean/difference": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  }
 ],
 "sdf3d/boolean/intersection": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  }
 ],
 "sdf3d/boolean/union": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  }
 ],
 "sdf3d/color": [
  {
   "label": "Local",
   "name": "local",
   "type": "boolean",
   "default": false
  }
 ],
 "sdf3d/generate/extrusion": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  },
  {
   "label": "Length",
   "name": "length",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  }
 ],
 "sdf3d/generate/revolution": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  },
  {
   "label": "Offset",
   "name": "offset",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  }
 ],
 "sdf3d/shapes/box": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  },
  {
   "label": "Size.x",
   "name": "size_x",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  },
  {
   "label": "Size.y",
   "name": "size_y",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  },
  {
   "label": "Size.z",
   "name": "size_z",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  }
 ],
 "sdf3d/shapes/cylinder": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Axis",
   "name": "axis",
   "type": "enum",
   "values": [
    {
     "name": "X",
     "value": "xyz"
    },
    {
     "name": "Y",
     "value": "yzx"
    },
    {
     "name": "Z",
     "value": "zxy"
    }
   ],
   "default": 0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  },
  {
   "label": "Height",
   "name": "height",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  },
  {
   "label": "Radius",
   "name": "radius",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  }
 ],
 "sdf3d/shapes/sphere": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  },
  {
   "label": "Radius",
   "name": "radius",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  }
 ],
 "sdf3d/shapes/torus": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Axis",
   "name": "axis",
   "type": "enum",
   "values": [
    {
     "name": "X",
     "value": "zxy"
    },
    {
     "name": "Y",
     "value": "xyz"
    },
    {
     "name": "Z",
     "value": "yzx"
    }
   ],
   "default": 0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  },
  {
   "label": "Radius1",
   "name": "R",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  },
  {
   "label": "Radius2",
   "name": "r",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.1
  }
 ],
 "sdf3d/smooth/smooth_union": [
  {
   "label": "Position.x",
   "name": "position_x",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.y",
   "name": "position_y",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Position.z",
   "name": "position_z",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.x",
   "name": "angle_x",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.y",
   "name": "angle_y",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Rotation.z",
   "name": "angle_z",
   "type": "float",
   "min": -180.0,
   "max": 180.0,
   "step": 0.01,
   "default": 0.0
  },
  {
   "label": "Scale",
   "name": "scale",
   "type": "float",
   "min": -1.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  },
  {
   "label": "K",
   "name": "k",
   "type": "float",
   "min": 0.0,
   "max": 5.0,
   "step": 0.01,
   "default": 1.0
  },
  {
   "label": "ColorK",
   "name": "color_k",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 0.5
  }
 ],
 "tex/blend": [],
 "tex/brightness_contrast": [
  {
   "default": 0.0,
   "label": "Brightness",
   "max": 1,
   "min": -1,
   "name": "brightness",
   "step": 0.01,
   "type": "float"
  },
  {
   "default": 1.0,
   "label": "Contrast",
   "max": 2,
   "min": 0,
   "name": "contrast",
   "step": 0.01,
   "type": "float"
  },
  {
   "default": true,
   "label": "Clamp",
   "name": "clamp",
   "type": "boolean"
  }
 ],
 "tex/deform": [
  {
   "default": 0.0,
   "label": "Amount",
   "max": 1,
   "min": -1,
   "name": "amount",
   "step": 0.01,
   "type": "float"
  }
 ],
 "tex/fbm": [
  {
   "default": 0,
   "label": "Noise",
   "name": "noise",
   "type": "enum",
   "values": [
    {
     "name": "Value",
     "value": "value"
    },
    {
     "name": "Perlin",
     "value": "perlin"
    },
    {
     "name": "Cellular",
     "value": "cellular"
    }
   ]
  },
  {
   "default": 4,
   "label": "Scale X",
   "max": 32,
   "min": 1,
   "name": "scale_x",
   "step": 1,
   "type": "float"
  },
  {
   "default": 4,
   "label": "Scale Y",
   "max": 32,
   "min": 1,
   "name": "scale_y",
   "step": 1,
   "type": "float"
  },
  {
   "default": 4,
   "label": "Scale Z",
   "max": 32,
   "min": 1,
   "name": "scale_z",
   "step": 1,
   "type": "float"
  },
  {
   "default": 0,
   "label": "Folds",
   "max": 5,
   "min": 0,
   "name": "folds",
   "step": 1,
   "type": "float"
  },
  {
   "default": 3,
   "label": "Iterations",
   "max": 10,
   "min": 1,
   "name": "iterations",
   "step": 1,
   "type": "float"
  },
  {
   "default": 0.5,
   "label": "Persistence",
   "max": 1,
   "min": 0,
   "name": "persistence",
   "step": 0.01,
   "type": "float"
  },
  {
   "default": 0,
   "label": "Offset",
   "max": 1,
   "min": 0,
   "name": "offset",
   "step": 0.01,
   "type": "float"
  }
 ],
 "tex/pattern": [
  {
   "default": 0,
   "label": "Combiner",
   "name": "mix",
   "type": "enum",
   "values": [
    {
     "name": "Multiply",
     "value": "mul"
    },
    {
     "name": "Add",
     "value": "add"
    },
    {
     "name": "Max",
     "value": "max"
    },
    {
     "name": "Min",
     "value": "min"
    },
    {
     "name": "Xor",
     "value": "xor"
    },
    {
     "name": "Pow",
     "value": "pow"
    }
   ]
  },
  {
   "default": 0,
   "label": "X",
   "name": "x_wave",
   "type": "enum",
   "values": [
    {
     "name": "Sine",
     "value": "sine"
    },
    {
     "name": "Triangle",
     "value": "triangle"
    },
    {
     "name": "Square",
     "value": "square"
    },
    {
     "name": "Sawtooth",
     "value": "sawtooth"
    },
    {
     "name": "Constant",
     "value": "constant"
    },
    {
     "name": "Bounce",
     "value": "bounce"
    }
   ]
  },
  {
   "control": "None",
   "default": 4,
   "label": "2:",
   "max": 32,
   "min": 0,
   "name": "x_scale",
   "step": 1,
   "type": "float"
  },
  {
   "default": 0,
   "label": "Y",
   "name": "y_wave",
   "type": "enum",
   "values": [
    {
     "name": "Sine",
     "value": "sine"
    },
    {
     "name": "Triangle",
     "value": "triangle"
    },
    {
     "name": "Square",
     "value": "square"
    },
    {
     "name": "Sawtooth",
     "value": "sawtooth"
    },
    {
     "name": "Constant",
     "value": "constant"
    },
    {
     "name": "Bounce",
     "value": "bounce"
    }
   ]
  },
  {
   "control": "None",
   "default": 4,
   "label": "3:",
   "max": 32,
   "min": 0,
   "name": "y_scale",
   "step": 1,
   "type": "float"
  },
  {
   "default": 0,
   "label": "Z",
   "name": "z_wave",
   "type": "enum",
   "values": [
    {
     "name": "Sine",
     "value": "sine"
    },
    {
     "name": "Triangle",
     "value": "triangle"
    },
    {
     "name": "Square",
     "value": "square"
    },
    {
     "name": "Sawtooth",
     "value": "sawtooth"
    },
    {
     "name": "Constant",
     "value": "constant"
    },
    {
     "name": "Bounce",
     "value": "bounce"
    }
   ]
  },
  {
   "control": "None",
   "default": 4,
   "label": "4:",
   "max": 32,
   "min": 0,
   "name": "z_scale",
   "step": 1,
   "type": "float"
  }
 ],
 "tex/simple_gradient": [
  {
   "label": "Color 1",
   "name": "color1",
   "type": "color",
   "default": {
    "r": 0.0,
    "g": 0.0,
    "b": 0.0,
    "a": 1.0
   }
  },
  {
   "label": "Color 2",
   "name": "color2",
   "type": "color",
   "default": {
    "r": 1.0,
    "g": 1.0,
    "b": 1.0,
    "a": 1.0
   }
  }
 ],
 "tex/step": [
  {
   "default": 0.5,
   "label": "Value",
   "max": 1,
   "min": 0,
   "name": "value",
   "step": 0.01,
   "type": "float"
  },
  {
   "default": 0.1,
   "label": "Width",
   "max": 0.5,
   "min": 0,
   "name": "width",
   "step": 0.01,
   "type": "float"
  },
  {
   "label": "Invert",
   "name": "invert",
   "type": "boolean",
   "default": false
  }
 ],
 "tex/uniform": [
  {
   "label": "Color",
   "name": "color",
   "type": "color",
   "default": {
    "r": 1.0,
    "g": 1.0,
    "b": 1.0,
    "a": 1.0
   }
  }
 ],
 "tex/uniform_gs": [
  {
   "label": "Value",
   "name": "value",
   "type": "float",
   "min": 0.0,
   "max": 1.0,
   "step": 0.01,
   "default": 1.0
  }
 ]
};
