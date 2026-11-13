import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ResourceType } from '@prisma/client';

export interface SpaceResource {
  id: string;
  locationId: string;
  hourlyRate: number;
  location: {
    name: string;
    city: string;
    country: string;
    currency: string;
    managerId?: string | null;
  };
}

export interface SpaceLocation {
  id: string;
  name: string;
  managerId?: string | null;
}

@Injectable()
export class SpaceClient {
  private readonly logger = new Logger(SpaceClient.name);
  private readonly baseUrl = process.env.SPACE_URL ?? 'http://localhost:3001';

  getResource(resourceType: ResourceType, resourceId: string): Promise<SpaceResource> {
    const path = resourceType === ResourceType.ROOM ? 'rooms' : 'desks';
    return this.get<SpaceResource>(`${path}/${resourceId}`, `El recurso ${resourceId} no existe`);
  }

  /** Se usa para saber qué gerente tiene a cargo una sede. */
  getLocation(locationId: string): Promise<SpaceLocation> {
    return this.get<SpaceLocation>(`locations/${locationId}`, `La sede ${locationId} no existe`);
  }

  private async get<T>(path: string, notFoundMessage: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${path}`, {
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      this.logger.error(`Space no respondió: ${(error as Error).message}`);
      throw new ServiceUnavailableException('No se pudo consultar el catálogo de espacios');
    }

    if (response.status === 404) {
      throw new NotFoundException(notFoundMessage);
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(`Space respondió con estado ${response.status}`);
    }
    return (await response.json()) as T;
  }
}