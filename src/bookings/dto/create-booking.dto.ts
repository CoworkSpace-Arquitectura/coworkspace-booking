import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ResourceType } from '@prisma/client';

export class CreateBookingDto {
  /**
   * A nombre de quién es la reserva. Un socio puede omitirlo (se usa su propia cuenta);
   * un gerente o el jefe lo envían para reservar a nombre de un cliente.
   */
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsUUID()
  resourceId!: string;

  @IsEnum(ResourceType)
  resourceType!: ResourceType;

  @IsDateString()
  startTime!: string;

  @IsDateString()
  endTime!: string;
}
