import { IsDateString, IsEnum, IsUUID } from 'class-validator';
import { ResourceType } from '@prisma/client';

export class CreateBookingDto {
  @IsUUID()
  memberId!: string;

  @IsUUID()
  resourceId!: string;

  @IsEnum(ResourceType)
  resourceType!: ResourceType;

  @IsDateString()
  startTime!: string;

  @IsDateString()
  endTime!: string;
}