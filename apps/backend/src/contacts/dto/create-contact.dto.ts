import { IsString, IsOptional, IsEmail, Matches } from 'class-validator';

// Compartido con la importación masiva (contacts-import.util.ts) — una sola
// definición de "qué es un teléfono válido" para ambos caminos de alta.
export const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

export class CreateContactDto {
  @IsString()
  @Matches(PHONE_REGEX, { message: 'Invalid phone number' })
  phone: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}
