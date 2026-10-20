import { useCallback, useEffect, useState } from 'react'
import { Cloud, CloudRain, Droplets, MapPin, Navigation, RefreshCw, Sun, Thermometer } from 'lucide-react'
import { getTodayWeather, type WeatherToday } from '../api'
import CityPicker from './CityPicker'

export default function WeatherCard() {
  const [data, setData] = useState<WeatherToday | null>(null)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [cityPickerOpen, setCityPickerOpen] = useState(false)

  const fetchWeather = useCallback(() => {
    setRefreshing(true)
    getTodayWeather()
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setRefreshing(false))
  }, [])

  useEffect(() => { fetchWeather() }, [fetchWeather])

  if (error && !data) {
    return (
      <div className="rounded-xl border border-[#E6DED3] bg-white p-3">
        <p className="text-xs text-slate-400">天气服务暂不可用</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-[#E6DED3] bg-white p-3 animate-pulse">
        <div className="h-4 w-24 rounded bg-slate-100" />
      </div>
    )
  }

  if (!data.ok) {
    return (
      <div className="rounded-xl border border-[#E6DED3] bg-white p-3">
        <div className="flex items-center gap-2">
          <Cloud className="h-5 w-5 text-slate-300" />
          <span className="text-xs text-slate-400">{data.locationName}</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">{data.rain_warning}</p>
      </div>
    )
  }

  const weatherIcon = data.rain_warning.includes('下雨') || data.rain_warning.includes('带伞')
    ? <CloudRain className="h-5 w-5 text-sky-500" />
    : data.text.includes('雨')
      ? <CloudRain className="h-5 w-5 text-sky-400" />
      : data.text.includes('晴')
        ? <Sun className="h-5 w-5 text-amber-400" />
        : <Cloud className="h-5 w-5 text-slate-400" />

  const tempText = data.temp !== null ? `${data.temp}°` : ''

  const hasExtra = data.feelsLike !== null || data.humidity !== null || data.windDir || data.windScale

  return (
    <>
      <div className="rounded-xl border border-[#E6DED3] bg-white p-3">
        {/* 第一行：地区名 + 切换按钮 + 刷新 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span className="text-xs text-slate-500 truncate">{data.locationName}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setCityPickerOpen(true)}
              className="text-[10px] text-[#6B7A5A] hover:text-[#5F704F] px-1.5 py-0.5 rounded-md hover:bg-[#F5F1EA] transition"
            >
              切换地区
            </button>
            <button
              type="button"
              onClick={fetchWeather}
              disabled={refreshing}
              className="grid h-6 w-6 place-items-center rounded-lg text-slate-400 hover:bg-[#F5F1EA] hover:text-slate-600 disabled:opacity-50 transition"
              title="刷新天气"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* 第二行：天气图标 + 天气文本 + 温度 */}
        <div className="mt-1.5 flex items-center gap-2">
          {weatherIcon}
          <span className="text-sm font-semibold text-slate-700">{data.text}</span>
          {tempText ? <span className="text-sm font-semibold text-slate-700">{tempText}</span> : null}
        </div>

        {/* 第三行：体感/湿度/风力 */}
        {hasExtra && (
          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-400">
            {data.feelsLike !== null && (
              <span className="flex items-center gap-1">
                <Thermometer className="h-3 w-3" />
                体感 {data.feelsLike}°
              </span>
            )}
            {data.humidity !== null && (
              <span className="flex items-center gap-1">
                <Droplets className="h-3 w-3" />
                {data.humidity}%
              </span>
            )}
            {(data.windDir || data.windScale) && (
              <span className="flex items-center gap-1">
                <Navigation className="h-3 w-3" />
                {data.windDir || ''} {data.windScale ? `${data.windScale}级` : ''}
              </span>
            )}
          </div>
        )}

        {/* 第四行：降雨提醒 */}
        <p className="mt-2 text-xs text-slate-500">{data.rain_warning}</p>
      </div>

      <CityPicker
        open={cityPickerOpen}
        currentLocationName={data.locationName}
        onClose={() => setCityPickerOpen(false)}
        onSaved={() => { fetchWeather() }}
      />
    </>
  )
}
