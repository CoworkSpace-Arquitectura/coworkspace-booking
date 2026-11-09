import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ResourceType } from '@prisma/client';

export interface SpaceResource {
  id: string;
  locationId: string;
}

@Injectable()
export class SpaceClient {
  private readonly logger = new Logger(SpaceClient.name);
  private readonly baseUrl = process.env.SPACE_URL ?? 'http://localhost:3001';

  async getResource(resourceType: ResourceType, resourceId: string): Promise<SpaceResource> {
    const path = resourceType === ResourceType.ROOM ? 'rooms' : 'desks';
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${path}/${resourceId}`, {
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      this.logger.error(`Space no respondió: ${(error as Error).message}`);
      throw new ServiceUnavailableException('No se pudo consultar el catálogo de espacios');
    }

    if (response.status === 404) {
      throw new NotFoundException(`El recurso ${resourceId} no existe`);
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(`Space respondió con estado ${response.status}`);
    }
    return (await response.json()) as SpaceResource;
  }
}