import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

mapboxgl.accessToken ='pk.eyJ1Ijoia21hMDA1IiwiYSI6ImNtcDduNDJqZTA0M2kycG9vbjFranZibWgifQ.Ww-ZO3wQZfbWY41L7FDsuQ';

const STATIONS_URL =
  'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

const TRAFFIC_URL =
  'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

const svg = d3.select('#map').select('svg');

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);

  return {
    cx: x,
    cy: y,
  };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);

  return date.toLocaleString('en-US', {
    timeStyle: 'short',
  });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }

  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);

    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id
  );

  return stations.map((station) => {
    let id = station.short_name;

    return {
      ...station,
      arrivals: arrivals.get(id) ?? 0,
      departures: departures.get(id) ?? 0,
      totalTraffic:
        (arrivals.get(id) ?? 0) +
        (departures.get(id) ?? 0),
    };
  });
}

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 3,
      'line-opacity': 0.5,
    },
  });

  map.addSource('cambridge-route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge-route',
    paint: {
      'line-color': '#32D400',
      'line-width': 3,
      'line-opacity': 0.5,
    },
  });

  const jsonData = await d3.json(STATIONS_URL);

  const originalStations =
    jsonData.data.stations;

  await d3.csv(TRAFFIC_URL, (trip) => {
    trip.started_at = new Date(
      trip.started_at
    );

    trip.ended_at = new Date(
      trip.ended_at
    );

    const startedMinutes =
      minutesSinceMidnight(trip.started_at);

    const endedMinutes =
      minutesSinceMidnight(trip.ended_at);

    departuresByMinute[startedMinutes].push(
      trip
    );

    arrivalsByMinute[endedMinutes].push(
      trip
    );

    return trip;
  });

  let stations =
    computeStationTraffic(originalStations);

  const radiusScale = d3
    .scaleSqrt()
    .domain([
      0,
      d3.max(stations, (d) => d.totalTraffic),
    ])
    .range([0, 25]);

  const stationFlow = d3
    .scaleQuantize()
    .domain([0, 1])
    .range([0, 0.5, 1]);

  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', (d) =>
      radiusScale(d.totalTraffic)
    )
    .style('--departure-ratio', (d) =>
      d.totalTraffic === 0
        ? 0.5
        : stationFlow(
            d.departures / d.totalTraffic
          )
    )
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    });

  function updatePositions() {
    circles
      .attr(
        'cx',
        (d) => getCoords(d).cx
      )
      .attr(
        'cy',
        (d) => getCoords(d).cy
      );
  }

  function updateScatterPlot(timeFilter) {
    const filteredStations =
      computeStationTraffic(
        originalStations,
        timeFilter
      );

    radiusScale
      .domain([
        0,
        d3.max(
          filteredStations,
          (d) => d.totalTraffic
        ),
      ])
      .range(
        timeFilter === -1
          ? [0, 25]
          : [3, 35]
      );

    circles
      .data(
        filteredStations,
        (d) => d.short_name
      )
      .attr('r', (d) =>
        radiusScale(d.totalTraffic)
      )
      .style('--departure-ratio', (d) =>
        d.totalTraffic === 0
          ? 0.5
          : stationFlow(
              d.departures / d.totalTraffic
            )
      )
      .select('title')
      .text(
        (d) =>
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
      );
  }

  const timeSlider =
    document.getElementById(
      'time-slider'
    );

  const selectedTime =
    document.getElementById(
      'selected-time'
    );

  const anyTimeLabel =
    document.getElementById('any-time');

  function updateTimeDisplay() {
    const timeFilter = Number(
      timeSlider.value
    );

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent =
        formatTime(timeFilter);

      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  updatePositions();
  updateTimeDisplay();

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  timeSlider.addEventListener(
    'input',
    updateTimeDisplay
  );
});