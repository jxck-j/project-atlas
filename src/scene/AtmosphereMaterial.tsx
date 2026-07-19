import { shaderMaterial } from '@react-three/drei'
import { extend } from '@react-three/fiber'
import { Color } from 'three'

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uPower;
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vec3 viewDir = normalize(-vPosition);
    float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), uPower);
    gl_FragColor = vec4(uColor, fresnel * uIntensity);
  }
`

const AtmosphereMaterialImpl = shaderMaterial(
  { uColor: new Color('#4CE0FF'), uIntensity: 1.1, uPower: 2.2 },
  vertexShader,
  fragmentShader
)

extend({ AtmosphereMaterialImpl })

declare module '@react-three/fiber' {
  interface ThreeElements {
    atmosphereMaterialImpl: any
  }
}

export function AtmosphereMaterial(props: {
  color?: string
  intensity?: number
  power?: number
  side?: number
}) {
  const { color = '#4CE0FF', intensity = 1.1, power = 2.2, side } = props
  return (
    <atmosphereMaterialImpl
      uColor={new Color(color)}
      uIntensity={intensity}
      uPower={power}
      transparent
      depthWrite={false}
      side={side}
    />
  )
}
