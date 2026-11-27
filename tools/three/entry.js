// Browser entry: only the parts of three.js that src/assets/logo3d.js uses, exposed as window.OxvaTHREE.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, ExtrudeGeometry, MeshPhysicalMaterial, MeshBasicMaterial,
  EdgesGeometry, LineSegments, LineBasicMaterial, AmbientLight, DirectionalLight, PointLight, PMREMGenerator,
  TorusGeometry, BufferGeometry, Float32BufferAttribute, Points, PointsMaterial, AdditiveBlending,
  FrontSide, BackSide, SRGBColorSpace, ACESFilmicToneMapping
} from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

window.OxvaTHREE = {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, ExtrudeGeometry, MeshPhysicalMaterial, MeshBasicMaterial,
  EdgesGeometry, LineSegments, LineBasicMaterial, AmbientLight, DirectionalLight, PointLight, PMREMGenerator,
  TorusGeometry, BufferGeometry, Float32BufferAttribute, Points, PointsMaterial, AdditiveBlending,
  FrontSide, BackSide, SRGBColorSpace, ACESFilmicToneMapping, SVGLoader, RoomEnvironment
};
