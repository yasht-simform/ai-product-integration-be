import { HttpService } from '@nestjs/axios';
import { Test, type TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';

import { WeatherTool } from '../tools/weather.tool';

describe('WeatherTool', () => {
  let service: WeatherTool;
  let httpMock: { get: jest.Mock };

  beforeEach(async () => {
    httpMock = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [WeatherTool, { provide: HttpService, useValue: httpMock }],
    }).compile();

    service = module.get<WeatherTool>(WeatherTool);
  });

  function mockGeocodingThenForecast(
    geocoding: unknown,
    forecast: unknown = {
      current: {
        temperature_2m: 18.5,
        relative_humidity_2m: 60,
        wind_speed_10m: 12,
        weather_code: 2,
      },
    },
  ): void {
    httpMock.get
      .mockReturnValueOnce(of({ data: geocoding }))
      .mockReturnValueOnce(of({ data: forecast }));
  }

  describe('execute()', () => {
    it('throws when city is missing', async () => {
      await expect(service.execute({ city: '' })).rejects.toThrow('city is required');
    });

    it('returns a well-shaped result for a resolvable city', async () => {
      mockGeocodingThenForecast({ results: [{ latitude: 51.5, longitude: -0.12 }] });

      const result = await service.execute({ city: 'London' });

      expect(result).toEqual({
        city: 'London',
        temperature: 18.5,
        units: 'celsius',
        humidity: 60,
        windSpeed: 12,
        conditions: 'Partly cloudy',
      });
    });

    it('defaults units to celsius when omitted', async () => {
      mockGeocodingThenForecast({ results: [{ latitude: 51.5, longitude: -0.12 }] });

      await service.execute({ city: 'London' });

      expect(httpMock.get).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({ temperature_unit: 'celsius' }),
        }),
      );
    });

    it('passes units: fahrenheit through to the forecast call', async () => {
      mockGeocodingThenForecast({ results: [{ latitude: 51.5, longitude: -0.12 }] });

      await service.execute({ city: 'London', units: 'fahrenheit' });

      expect(httpMock.get).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({ temperature_unit: 'fahrenheit' }),
        }),
      );
    });

    it('throws a clear error when geocoding returns zero results', async () => {
      httpMock.get.mockReturnValueOnce(of({ data: { results: [] } }));

      await expect(service.execute({ city: 'Nowhereville' })).rejects.toThrow(
        'Could not find location: Nowhereville',
      );
    });

    it('throws a clear error when geocoding omits the results key entirely', async () => {
      httpMock.get.mockReturnValueOnce(of({ data: {} }));

      await expect(service.execute({ city: 'Nowhereville' })).rejects.toThrow(
        'Could not find location: Nowhereville',
      );
    });

    it('falls back to "Unknown" for an uncovered weather code', async () => {
      mockGeocodingThenForecast(
        { results: [{ latitude: 51.5, longitude: -0.12 }] },
        {
          current: {
            temperature_2m: 18.5,
            relative_humidity_2m: 60,
            wind_speed_10m: 12,
            weather_code: 9999,
          },
        },
      );

      const result = await service.execute({ city: 'London' });

      expect(result.conditions).toBe('Unknown');
    });
  });
});
