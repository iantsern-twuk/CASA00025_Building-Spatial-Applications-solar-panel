// PV HEAT IMPACT TRACKER - Basic parameters

//0. Replace our real map data here
var solarPanels = ee.FeatureCollection([
    ee.Feature(geometry, {name: 'abc', construction_date: '2020-05-22', area: 0.65, township: 'a town'}),
  
    ee.Feature(geometry2)
  ]).style({color: 'yellow', fillColor: '88ffff00'});
  
var fishFarms = ee.FeatureCollection([
  ee.Feature(geometry3).set({type: 'fishFarm'})
]).style({color: 'blue', fillColor: '8800ffff'});

var population = ee.ImageCollection('CIESIN/GPWv411/GPW_Population_Count')
  .filter(ee.Filter.date('2020-01-01', '2020-12-31')).first();
  
var popDensity = ee.Image().byte().paint(
  ee.FeatureCollection([ee.Feature(geometry4.buffer(2000), {density: 100})]), 'density');

var tempImage = ee.Image('users/yenlin/temp');

// 1. Create sample data for charts (2020-2024) - we need to calculate real data to replace these
var temp = ee.FeatureCollection([
    ee.Feature(null, {year: 2020, temp: 0.3}), ee.Feature(null, {year: 2021, temp: 0.42}),
    ee.Feature(null, {year: 2022, temp: 0.35}), ee.Feature(null, {year: 2023, temp: 0.38}),
    ee.Feature(null, {year: 2024, temp: 0.45})
]);
var solar = ee.FeatureCollection([
    ee.Feature(null, {year: 2020, area: 0.2}), ee.Feature(null, {year: 2021, area: 0.35}),
    ee.Feature(null, {year: 2022, area: 0.48}), ee.Feature(null, {year: 2023, area: 0.58}),
    ee.Feature(null, {year: 2024, area: 0.65})
]);
var population = ee.FeatureCollection([
    ee.Feature(null, {year: 2020, population: 3254}), ee.Feature(null, {year: 2021, population: 4125}),
    ee.Feature(null, {year: 2022, population: 5214}), ee.Feature(null, {year: 2023, population: 6321}),
    ee.Feature(null, {year: 2024, population: 7232})
]);

// Merge chart data into a single object for easier management
var chartData = {
  temp: temp,
  solar: solar,
  population: population
};

// 2. Clear UI and define core functions
ui.root.clear();

// Chart creation function
function createLineChart(data, valueField, color) {
  return ui.Chart.feature.byFeature(data, 'year', [valueField])
    .setChartType('LineChart')
    .setOptions({
      title: '', vAxis: {title: ''}, hAxis: {title: ''},
      pointSize: 3, lineWidth: 2, legend: {position: 'none'},
      series: {0: {color: color}}, chartArea: {width: '85%', height: '80%'}
    });
}


// 3. Initialize main UI components
var mainPanel = ui.Panel({
  layout: ui.Panel.Layout.flow('vertical'),
  style: {width: '500px', padding: '10px'}
});

var map = ui.Map();
map.setOptions('HYBRID');
map.setCenter(120.10001715283622, 23.17246597271925, 12.5);

// 4. Add layers to map
map.addLayer(solarPanels, {}, 'Solar Panels');
map.addLayer(fishFarms, {}, 'Fish Farms', false);
map.addLayer(tempImage, {}, 'Temperature', false);
map.addLayer(popDensity, {}, 'Population', false);

// 5. Create UI panels and buttons
mainPanel.add(ui.Panel({
  widgets: [ui.Label('PV HEAT IMPACT TRACKER', 
    {fontWeight: 'bold', fontSize: '18px', margin: '0 0 10px 0', padding: '6px'})],
  style: {padding: '0'}
}));

// Content panels
var visualizeContent = ui.Panel({style: {border: '1px solid #999', padding: '8px'}});
var predictedContent = ui.Panel({
  widgets: [ui.Label('Still working', {fontSize: '16px', padding: '20px'})],
  style: {border: '1px solid #999', padding: '8px'}
});

// Navigation buttons
var buttons = {
  visualize: ui.Button({
    label: 'Visualize',
    onClick: function() {
      showPanel(visualizeContent, buttons.visualize, buttons.predict);
    },
    style: {padding: '4px', fontWeight: 'bold', backgroundColor: '#ffffff', 
            border: '1px solid #dddddd', margin: '0 2px 0 0'}
  }),
  predict: ui.Button({
    label: 'Predicted',
    onClick: function() {
      showPanel(predictedContent, buttons.predict, buttons.visualize);
    },
    style: {padding: '4px', fontWeight: 'bold', backgroundColor: '#ffffff', 
            border: '1px solid #dddddd', margin: '0 2px 0 0'}
  })
};

// Button panel and container
var buttonPanel = ui.Panel([buttons.visualize, buttons.predict], 
  ui.Panel.Layout.flow('horizontal'), {margin: '0 0 20px 0'});
var contentContainer = ui.Panel();

// 6. Create charts and tabs
var charts = {
  temp: createLineChart(temp, 'temp', '#ff5555'),
  solar: createLineChart(solar, 'area', '#ffcc00'),
  population: createLineChart(population, 'population', '#5599ff')
};

var chartContainer = ui.Panel({
  style: {height: '250px', border: '1px solid #ddd', margin: '10px 0', padding: '0'}
});

// Track current active chart type
var currentChartType = 'temp'; // 'temp', 'solar' or 'population'

// Simplified activateChartTab function
function activateChartTab(tabType) {
  // Update current chart type
  currentChartType = tabType;
  
  // Reset all tab styles
  for (var key in chartTabs) {
    var isActive = (key === tabType);
    chartTabs[key].style().set({
      fontWeight: isActive ? 'bold' : 'normal',
      backgroundColor: isActive ? '#ffffff' : '#f0f0f0'
    });
  }
  
  // Create chart configuration object
  var chartConfig = {
    'temp': {data: chartData.temp, field: 'temp', color: '#ff5555'},
    'solar': {data: chartData.solar, field: 'area', color: '#ffcc00'},
    'population': {data: chartData.population, field: 'population', color: '#5599ff'}
  };
  
  // Use configuration to dynamically create chart
  var config = chartConfig[tabType];
  var newChart = createLineChart(config.data, config.field, config.color);
  
  // Update chart
  chartContainer.widgets().reset([newChart]);
}

// Chart tab buttons
var chartTabs = {
  temp: ui.Button({
    label: 'Temperature',
    onClick: function() { 
      activateChartTab('temp'); 
    },
    style: {
      padding: '4px', 
      fontWeight: 'bold', 
      backgroundColor: '#ffffff', 
      border: '1px solid #dddddd', 
      margin: '0 2px 0 0'
    }
  }),
  
  solar: ui.Button({
    label: 'Solar panels',
    onClick: function() { 
      activateChartTab('solar'); 
    },
    style: {
      padding: '4px', 
      backgroundColor: '#f0f0f0', 
      border: '1px solid #dddddd', 
      margin: '0 2px 0 0'
    }
  }),
  
  population: ui.Button({
    label: 'At-risk population',
    onClick: function() {
      activateChartTab('population'); 
    },
    style: {
      padding: '4px', 
      backgroundColor: '#f0f0f0', 
      border: '1px solid #dddddd',
      margin: '0 2px 0 0'
    }
  })
};

// 7. Define UI functionality
function showPanel(panel, activeButton, inactiveButton) {
  contentContainer.clear();
  contentContainer.add(panel);
  
  activeButton.style().set({backgroundColor: 'black', fontWeight: 'bold'});
  inactiveButton.style().set({backgroundColor: '#718096', fontWeight: 'normal'});
  
  // If switching back to visualization panel, ensure current chart is reloaded
  if (panel === visualizeContent) {
    // Recreate chart based on current chart type
    var currentChart;
    if (currentChartType === 'temp') {
      currentChart = createLineChart(temp, 'temp', '#ff5555');
      // Update tab states
      chartTabs.temp.style().set({fontWeight: 'bold', backgroundColor: '#ffffff'});
      chartTabs.solar.style().set({fontWeight: 'normal', backgroundColor: '#f0f0f0'});
      chartTabs.population.style().set({fontWeight: 'normal', backgroundColor: '#f0f0f0'});
    } else if (currentChartType === 'solar') {
      currentChart = createLineChart(solar, 'area', '#ffcc00');
      // Update tab states
      chartTabs.temp.style().set({fontWeight: 'normal', backgroundColor: '#f0f0f0'});
      chartTabs.solar.style().set({fontWeight: 'bold', backgroundColor: '#ffffff'});
      chartTabs.population.style().set({fontWeight: 'normal', backgroundColor: '#f0f0f0'});
    } else { // population
      currentChart = createLineChart(population, 'population', '#5599ff');
      // Update tab states
      chartTabs.temp.style().set({fontWeight: 'normal', backgroundColor: '#f0f0f0'});
      chartTabs.solar.style().set({fontWeight: 'normal', backgroundColor: '#f0f0f0'});
      chartTabs.population.style().set({fontWeight: 'bold', backgroundColor: '#ffffff'});
    }
    
    // Re-add chart to container
    chartContainer.widgets().reset([currentChart]);
  }
}

// Helper functions for UI components
function createSlider(label, min, current) {
  var panel = ui.Panel({style: {margin: '5px 0'}});
  panel.add(ui.Label(label, {margin: '2px 0'}));
  var slider = ui.Panel({layout: ui.Panel.Layout.flow('horizontal'), style: {margin: '2px 0', padding: '0'}});
  slider.add(ui.Label(min, {margin: '0', fontSize: '10px'}))
    .add(ui.Panel({style: {width: '200px', height: '5px', backgroundColor: '#000000', margin: '7px 5px'}}))
    .add(ui.Label(current, {margin: '0', fontSize: '14px', textAlign: 'right'}));
  return panel.add(slider);
}

function createLayerControl(label, layerIndex, defaultValue) {
  return ui.Panel([ui.Checkbox(label, defaultValue, function(checked) {
    if(map.layers().length() > layerIndex) map.layers().get(layerIndex).setShown(checked);
  })], ui.Panel.Layout.flow('horizontal'), {margin: '2px 0'});
}

// 9. Build visualization panel
var tempTabPanel = ui.Panel([chartTabs.temp, chartTabs.solar, chartTabs.population], 
  ui.Panel.Layout.flow('horizontal'), {margin: '4px 0'});

visualizeContent.add(ui.Label('Yearly statistics', {fontWeight: 'bold', margin: '8px 0'}));
visualizeContent.add(tempTabPanel);
visualizeContent.add(chartContainer);
visualizeContent.add(ui.Label('Index', {fontWeight: 'bold', margin: '10px 0 5px 0'}));
visualizeContent.add(createSlider('Temperature', '+0 °C', '0.45 °C\n+0.27 °C'));
visualizeContent.add(createSlider('NDVI', '0', '-0.7\n-0.8'));
visualizeContent.add(createSlider('Solar panels area', '0 km²', '0.65 km²\n1 km²'));
visualizeContent.add(createSlider('At-risk population', '523', '7,232 people\n10,025'));
visualizeContent.add(ui.Label('Layers', {fontWeight: 'bold', margin: '15px 0 5px 0'}));
visualizeContent.add(createLayerControl('Solar panel', 0, true));
visualizeContent.add(createLayerControl('Fish farm', 1, false));
visualizeContent.add(createLayerControl('Temperature', 2, false));
visualizeContent.add(createLayerControl('Population', 3, false));

// 10. Assemble UI and initialize
mainPanel.add(buttonPanel);
mainPanel.add(contentContainer);

// Add map click handler for information panels
map.onClick = function(coords) {
  var point = ee.Geometry.Point(coords.lon, coords.lat);
  map.layers().forEach(function(layer) {
    if (layer.get('name') === 'infoPanel') map.remove(layer);
  });
  
  solarPanels.filterBounds(point).size().evaluate(function(size) {
    if (size > 0) {
      solarPanels.filterBounds(point).first().toDictionary().evaluate(function(info) {
        var panel = ui.Panel({style: {position: 'top-right', padding: '8px', 
          width: '320px', backgroundColor: 'rgba(25, 25, 25, 0.8)'}});
        panel.set('name', 'infoPanel');
        panel.add(ui.Label('Information', {fontWeight: 'bold', color: 'white', margin: '0 0 6px 0'}))
          .add(ui.Label('Power Plant name: ' + info.name, {color: 'white', margin: '2px 0'}))
          .add(ui.Label('Construction date: ' + info.construction_date, {color: 'white', margin: '2px 0'}))
          .add(ui.Label('Area: ' + info.area + ' km²', {color: 'white', margin: '2px 0'}))
          .add(ui.Label('Township: ' + info.township, {color: 'white', margin: '2px 0'}))
          .add(ui.Label('Type: ' + info.type, {color: 'white', margin: '2px 0'}));
        map.add(panel);
      });
    }
  });
};

// Initialize default view
showPanel(visualizeContent, buttons.visualize, buttons.predict);

// Add to UI root
ui.root.add(ui.Panel([mainPanel, map], ui.Panel.Layout.flow('horizontal'), 
  {width: '100%', height: '100%'}));