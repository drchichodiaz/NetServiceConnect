import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
  IsBoolean,
  IsArray,
  ValidateNested,
  MinLength,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateAgendaSettingsDto {
  /** Duracion por defecto de una cita. De a 15 para que calce en la grilla. */
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(240)
  slotMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(72)
  reminderHoursBefore?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  doctorSummaryHour?: number;

  /** Cadena vacia = ese aviso no se manda. */
  @IsOptional()
  @IsString()
  confirmationTemplateId?: string;

  @IsOptional()
  @IsString()
  reminderTemplateId?: string;

  @IsOptional()
  @IsString()
  doctorSummaryTemplateId?: string;

  @IsOptional()
  @IsString()
  delayTemplateId?: string;
}

export class CreateDoctorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  /** Cadena vacia = sin WhatsApp: no recibe el resumen del dia. */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export class UpdateDoctorDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ShiftDto {
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  startMinute: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  endMinute: number;

  @IsString()
  channelAccountId: string;
}

/** El turno semanal completo de un doctor: reemplaza al que tenia. */
export class SetShiftsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ShiftDto)
  shifts: ShiftDto[];
}

export class CreateExceptionDto {
  @IsString()
  doctorId: string;

  /** Dia local de la clinica, YYYY-MM-DD. */
  @IsString()
  date: string;

  @IsIn(['ABSENT', 'WORKS_AT'])
  kind: 'ABSENT' | 'WORKS_AT';

  /** Sin horario = el dia entero (solo en ABSENT). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  startMinute?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  endMinute?: number;

  /** Solo WORKS_AT: la clinica de ese dia. */
  @IsOptional()
  @IsString()
  channelAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
