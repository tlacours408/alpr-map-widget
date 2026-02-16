//	app.js
'use strict';

var mapObj = null;
var pointList = [];
var clusterLayer = null;

var searchMarker = null;
var searchCircle = null;

var radiusMilesInput = null;
var radiusMilesLabel = null;
var cameraCountEl = null;
var statusLineEl = null;

var minZoomForPoints = 10;

function milesToMeters(milesValue){
	return Number(milesValue) * 1609.344;
}

function setStatusLine(statusText){
	statusLineEl.textContent = String(statusText || '');
}

function setCountText(countValue){
	cameraCountEl.textContent = String(countValue);
}

function setRadiusLabel(milesValue){
	radiusMilesLabel.textContent = String(Number(milesValue).toFixed(1));
}

function shouldShowPoints(){
	return mapObj.getZoom() >= minZoomForPoints;
}

function rebuildClusterMarkersIfNeeded(){
	//	marker clustering with tens of thousands of points is expensive, so only show them when zoomed in
	if (!clusterLayer || !mapObj) return;

	if (shouldShowPoints()){
		if (!mapObj.hasLayer(clusterLayer)){
			mapObj.addLayer(clusterLayer);
			setStatusLine('Showing points (zoom ' + String(mapObj.getZoom()) + '+).');
		}
	} else {
		if (mapObj.hasLayer(clusterLayer)){
			mapObj.removeLayer(clusterLayer);
			setStatusLine('Zoom in to see points (>= ' + String(minZoomForPoints) + ').');
		}
	}

	forceLeafletResize();
}

function haversineDistanceMeters(lat1, lon1, lat2, lon2){
	//	stable, dependency-free distance check for "point within radius" across large areas
	var rad = Math.PI / 180;

	var dLat = (lat2 - lat1) * rad;
	var dLon = (lon2 - lon1) * rad;

	var aLat1 = lat1 * rad;
	var aLat2 = lat2 * rad;

	var sinDLat = Math.sin(dLat / 2);
	var sinDLon = Math.sin(dLon / 2);

	var a = sinDLat * sinDLat + Math.cos(aLat1) * Math.cos(aLat2) * sinDLon * sinDLon;
	var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

	return 6371000 * c;
}

function countPointsInCircle(centerLat, centerLon, radiusMeters){
	var i = 0;
	var insideCount = 0;

	for (i = 0; i < pointList.length; i++){
		if (haversineDistanceMeters(centerLat, centerLon, pointList[i].lat, pointList[i].lon) <= radiusMeters){
			insideCount++;
		}
	}

	return insideCount;
}

function updateCircleAndCount(){
	var centerLatLng = searchMarker.getLatLng();
	var radiusMilesValue = Number(radiusMilesInput.value);
	var radiusMetersValue = milesToMeters(radiusMilesValue);

	setRadiusLabel(radiusMilesValue);
	searchCircle.setLatLng(centerLatLng);
	searchCircle.setRadius(radiusMetersValue);

	//	MVP so brute-force counting is acceptable here, and easy to validate
	var countValue = countPointsInCircle(centerLatLng.lat, centerLatLng.lng, radiusMetersValue);
	setCountText(countValue);

	return true;
}

function setSearchCenter(latValue, lonValue, shouldRecenterMap){
	var latLngObj = L.latLng(latValue, lonValue);

	searchMarker.setLatLng(latLngObj);
	searchCircle.setLatLng(latLngObj);

	if (shouldRecenterMap){
		mapObj.setView(latLngObj, Math.max(mapObj.getZoom(), minZoomForPoints));
	}

	updateCircleAndCount();
}

function onUseMyLocationClick(){
	if (!navigator.geolocation){
		setStatusLine('Geolocation not available in this browser.');
		return;
	}

	setStatusLine('Requesting location…');

	navigator.geolocation.getCurrentPosition(
		function(positionObj){
			var latValue = positionObj.coords.latitude;
			var lonValue = positionObj.coords.longitude;

			setStatusLine('Location set.');
			setSearchCenter(latValue, lonValue, true);
		},
		function(errorObj){
			setStatusLine('Could not get location (permission denied or unavailable).');
		},
		{
			enableHighAccuracy: false,
			timeout: 10000,
			maximumAge: 60000
		}
	);
}

function buildClusterLayer(){
	var i = 0;

	//	clustering reduces DOM load once zoomed in enough to display points
	clusterLayer = L.markerClusterGroup({
		disableClusteringAtZoom: 14,
		showCoverageOnHover: false,
		chunkedLoading: true
	});

	for (i = 0; i < pointList.length; i++){
		clusterLayer.addLayer(L.marker([pointList[i].lat, pointList[i].lon]));
	}
}

function loadDeflockJson(){
	//	fetch keeps hosting dead-simple on GitHub Pages
	return fetch('./deflockPoints.json')
		.then(function(responseObj){
			if (!responseObj.ok){
				throw new Error('HTTP ' + String(responseObj.status));
			}
			return responseObj.json();
		})
		.then(function(deflockObj){
			var elementList = deflockObj && deflockObj.elements ? deflockObj.elements : [];
			var i = 0;

			for (i = 0; i < elementList.length; i++){
				if (elementList[i] && typeof elementList[i].lat === 'number' && typeof elementList[i].lon === 'number'){
					pointList.push({ lat: elementList[i].lat, lon: elementList[i].lon });
				}
			}

			return true;
		});
}

function initUiRefs(){
	radiusMilesInput = document.getElementById('radiusMiles');
	radiusMilesLabel = document.getElementById('radiusMilesLabel');
	cameraCountEl = document.getElementById('cameraCount');
	statusLineEl = document.getElementById('statusLine');

	document.getElementById('useMyLocation').addEventListener('click', onUseMyLocationClick);

	//	use change (not input) so it updates after release performance
	radiusMilesInput.addEventListener('change', function(){
		updateCircleAndCount();
	});
}

function forceLeafletResize(){
	//	Leaflet often mismeasures when loaded inside responsive iframes
	if (!mapObj) return false;

	//	invalidating a zero-sized container causes Leaflet to "lock in" a bad size
	var mapEl = document.getElementById('map');
	if (!mapEl || mapEl.clientHeight === 0 || mapEl.clientWidth === 0) return false;

	setTimeout(function(){
		mapObj.invalidateSize(true);
	}, 50);

	setTimeout(function(){
		mapObj.invalidateSize(true);
	}, 250);

	return true;
}


function initMap(){
	//	Defaulting to Minnesota because.
	mapObj = L.map('map', {
		worldCopyJump: true,
		zoomControl: false
	}).setView([46.3, -94.2], 6);

	
	//	default zoom controls overlap left-side UI, so reposition them
	L.control.zoom({
		position: 'topright'
	}).addTo(mapObj);


	L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
		maxZoom: 19,
		attribution: '&copy; OpenStreetMap contributors'
	}).addTo(mapObj);

	//	divIcon avoids bundling marker image assets just to change a color
	var searchMarkerIcon = L.divIcon({
		className: '',
		html: '<div class=\'searchMarkerIcon\'></div>',
		iconSize: [18, 18],
		iconAnchor: [9, 9]
	});
	
	searchMarker = L.marker([46.3, -94.2], { draggable: true, icon: searchMarkerIcon }).addTo(mapObj);


	//	circle gives immediate visual feedback on the query area
	searchCircle = L.circle([39.5, -98.35], {
		radius: milesToMeters(Number(document.getElementById('radiusMiles').value)),
		weight: 2,
		fillOpacity: 0.15
	}).addTo(mapObj);

	//	Why: click-to-set is faster than dragging on mobile and avoids “fighting the map”
	mapObj.on('click', function(evtObj){
		if (!evtObj || !evtObj.latlng) return;
		setSearchCenter(evtObj.latlng.lat, evtObj.latlng.lng, false);
	});


	
	//	count should update after the user finishes dragging
	searchMarker.on('dragend', function(){
		updateCircleAndCount();
	});

	mapObj.on('zoomend', function(){
		rebuildClusterMarkersIfNeeded();
	});

	forceLeafletResize();
}

function main(){
	initUiRefs();
	initMap();

	window.addEventListener('resize', function(){
		forceLeafletResize();
	});

	setStatusLine('Loading point data…');

	loadDeflockJson()
		.then(function(){
			buildClusterLayer();
			rebuildClusterMarkersIfNeeded();
			updateCircleAndCount();

			setStatusLine('Loaded ' + String(pointList.length) + ' points. Ready.');
			forceLeafletResize();
			console.log('Successful: map initialized.');
		})
		.catch(function(errObj){
			setStatusLine('Failed to load points: ' + String(errObj && errObj.message ? errObj.message : errObj));
			setCountText('Error');
			console.log('Not successful: map initialization failed.');
		});
}

main();
