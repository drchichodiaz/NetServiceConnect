import { IsString, IsOptional } from 'class-validator';

// Payload que el frontend envía tras el FB.login del Embedded Signup.
// El backend hace el intercambio de código → token (nunca pasa por el frontend).
export class EmbeddedSignupDto {
  @IsString()
  code: string;

  // Vienen del postMessage de Meta (sessionInfoVersion 3) — opcionales como fallback
  @IsOptional()
  @IsString()
  wabaId?: string;

  @IsOptional()
  @IsString()
  phoneNumberId?: string;
}

// Para activar un número que requirió PIN de 2FA tras el signup
export class RegisterPhoneWithPinDto {
  @IsString()
  pin: string;
}

// Conexión manual con token de la página API Setup de Meta (para desarrollo/pruebas)
export class ConnectDirectDto {
  @IsString()
  accessToken: string;

  @IsString()
  phoneNumberId: string;

  @IsOptional()
  @IsString()
  wabaId?: string;
}
