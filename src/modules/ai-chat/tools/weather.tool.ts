import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

// Open-Meteo's WMO weather_code table — common codes only, uncovered codes fall back to
// "Unknown" (per spec §8.2) rather than throwing, since this is a display string, not a value the
// caller branches on.
const WEATHER_CODE_DESCRIPTIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow fall',
  73: 'Moderate snow fall',
  75: 'Heavy snow fall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

export interface WeatherArgs {
  city: string;
  units?: 'celsius' | 'fahrenheit';
}

export interface WeatherResult {
  city: string;
  temperature: number;
  units: 'celsius' | 'fahrenheit';
  humidity: number;
  windSpeed: number;
  conditions: string;
}

interface GeocodingResult {
  latitude: number;
  longitude: number;
}

interface GeocodingResponse {
  results?: GeocodingResult[];
}

interface ForecastResponse {
  current: {
    temperature_2m: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    weather_code: number;
  };
}

@Injectable()
export class WeatherTool {
  constructor(private readonly http: HttpService) {}

  async execute(args: WeatherArgs): Promise<WeatherResult> {
    const { city, units = 'celsius' } = args;
    if (typeof city !== 'string' || city.trim().length === 0) {
      throw new Error('city is required');
    }

    const location = await this.geocode(city);
    return this.forecast(city, location, units);
  }

  private async geocode(city: string): Promise<GeocodingResult> {
    const response = await firstValueFrom(
      this.http.get<GeocodingResponse>(GEOCODING_URL, { params: { name: city, count: 1 } }),
    );

    const [result] = response.data.results ?? [];
    if (!result) {
      throw new Error(`Could not find location: ${city}`);
    }
    return result;
  }

  private async forecast(
    city: string,
    location: GeocodingResult,
    units: 'celsius' | 'fahrenheit',
  ): Promise<WeatherResult> {
    const response = await firstValueFrom(
      this.http.get<ForecastResponse>(FORECAST_URL, {
        params: {
          latitude: location.latitude,
          longitude: location.longitude,
          current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
          temperature_unit: units,
        },
      }),
    );

    const { current } = response.data;
    return {
      city,
      temperature: current.temperature_2m,
      units,
      humidity: current.relative_humidity_2m,
      windSpeed: current.wind_speed_10m,
      conditions: WEATHER_CODE_DESCRIPTIONS[current.weather_code] ?? 'Unknown',
    };
  }
}
