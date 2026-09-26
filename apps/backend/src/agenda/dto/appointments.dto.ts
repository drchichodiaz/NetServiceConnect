import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateAppointmentDto {
  /** La clinica (linea de WhatsApp). */
  @IsString()
  channelAccountId: string;

  /** Instante ISO. Tiene que caer en :00, :15, :30 o :45 de la hora local. */
  @IsString()
  startsAt: string;

  /** Sin duracion = la de la empresa (45 en Red Dental). */
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(240)
  minutes?: number;

  /** Paciente existente. Si no viene, se usa phone (+ name) para crearlo o encontrarlo. */
  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /** Solo si la recepcion elige doctor a mano. Sin esto lo asigna el sistema. */
  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateAppointmentDto {
  @IsOptional()
  @IsString()
  channelAccountId?: string;

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(240)
  minutes?: number;

  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ExtendAppointmentDto {
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(120)
  minutes?: number;
}

export class SetAppointmentStatusDto {
  @IsIn(['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'DONE', 'NO_SHOW', 'CANCELLED'])
  status: 'SCHEDULED' | 'CONFIRMED' | 'ARRIVED' | 'DONE' | 'NO_SHOW' | 'CANCELLED';
}
