# Preview meshes

`pillow.obj`, `suzanne.obj` and `vase.obj` are copied unchanged from Material Maker's `material_maker/meshes/`,
part of that repository and so under its MIT license (`../LICENSE.md`). Their headers show they were exported from
Blender 2.82. `suzanne.obj` is Blender's Suzanne monkey primitive, which the Blender Foundation lets anyone use;
Material Maker uses it as the default custom model of its 3D preview.

The app serves copies of them from `public/meshes/`.

The HDR environment images in `public/hdri/` (`photo_studio_01_1k.hdr`, `epping_forest_01_1k.hdr`,
`moonless_golf_1k.hdr`) come from Material Maker's `material_maker/environments/hdris/`; they are Poly Haven
(formerly HDRI Haven) images, released as CC0. `../environments/environments.json` is Material Maker's list of the
three environments built on them.
