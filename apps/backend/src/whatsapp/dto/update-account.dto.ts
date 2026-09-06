import { IsOptional, IsString, IsInt, MaxLength } from 'class-validator';

export class UpdateAccountDto {
  /** Nombre operativo de la linea, ej: "Sucursal Palermo". Vacio = volver a mostrar el numero. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
