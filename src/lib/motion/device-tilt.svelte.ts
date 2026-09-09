// The device-tilt vector the layout's TinyVectors mount already produces,
// republished for the wiper scene. One sensor listener on the page, one
// permission path (the first-tap handshake); the scene only reads.
export interface DeviceTilt {
	x: number;
	y: number;
	z: number;
}

export const deviceTilt: DeviceTilt = $state({ x: 0, y: 0, z: 0 });

export function setDeviceTilt(vector: DeviceTilt): void {
	deviceTilt.x = vector.x;
	deviceTilt.y = vector.y;
	deviceTilt.z = vector.z;
}
