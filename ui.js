// PV HEAT IMPACT TRACKER

// Import required packages
var palettes = require('users/gena/packages:palettes');
var style = require('users/gena/packages:style');

// ------ Load in data ------
var taiwan = ee.FeatureCollection('projects/ee-jess-es/assets/village_tainan');
var solar = ee.FeatureCollection('projects/ee-jess-es/assets/polygons_jin2'); 
var polygons = solar.filterBounds(taiwan);
var fishfarms = ee.FeatureCollection('projects/ee-jess-es/assets/fish-farms2');
var HRSL_total = ee.ImageCollection('projects/sat-io/open-datasets/hrsl/hrslpop').filterBounds(taiwan).median();

// ------ LST Calculations ------

// Cloud mask function
function cloudMask(img) {
  var scored = ee.Algorithms.Landsat.simpleCloudScore(img);
  var mask = scored.select(['cloud']).lte(15);
  return img.updateMask(mask);
}

function getLST(geom, start, end) {
  var collection = ee.ImageCollection('LANDSAT/LC08/C02/T1_TOA')
    .filterBounds(geom)
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUD_COVER',25));

  var lstCollection = collection.map(function(img) {
    var ndvi = img.normalizedDifference(['B5', 'B4']).rename('NDVI');
    var fv = ndvi.subtract(0).divide(1 - 0).rename('FV');
    var em = fv.multiply(0.004).add(0.986).rename('EM');
    var thermal = img.select('B10');
    var lst = thermal.expression(
      '(Tb / (1 + (0.00115 * (Tb / 1.438)) * log(Ep))) - 273.15',
      {
        'Tb': thermal,
        'Ep': em
      }
    ).rename('LST');

    //Extra variables for the random forest: optical bands, thermal bands, NDBI, and NDVI, FV, EM
    var optical = img.select(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']);
    var thermalBands = img.select(['B10', 'B11']);
    var ndbi = img.normalizedDifference(['B6', 'B5']).rename('NDBI');
    return lst.addBands([ndvi, fv, em, ndbi]).addBands(optical).addBands(thermalBands).copyProperties(img, img.propertyNames());
  });

  var mean = ee.Image(lstCollection.mean());
  var bands = mean.bandNames();
  var hasLST = bands.contains('LST');
  return ee.Algorithms.If(hasLST, mean.clip(geom), ee.Image().rename('LST').clip(geom));
}

// Calculate LST for all polygons
function calculateLST(feature) {
  var dateString = ee.String(feature.get('dateright'));
  var parts = dateString.split('-');
  var year = ee.Number.parse(parts.get(0));
  var month = ee.Number.parse(parts.get(1));
  var day = ee.Number.parse(parts.get(2));
  var constructDate = ee.Date.fromYMD(year, month, day);

  var preStart = constructDate.advance(-3, 'year');
  var preEnd = constructDate;
  var postStart = constructDate.advance(1, 'year');
  var postEnd = constructDate.advance(4, 'year');

  var geom = feature.geometry();
  var preImage = ee.Image(getLST(geom, preStart, preEnd));
  var postImage = ee.Image(getLST(geom, postStart, postEnd));
  var diff = postImage.select('LST').subtract(preImage.select('LST')).rename('LST_Difference');

  // Reducers for LST calculations
  var meanPreLSTDict = preImage.select('LST').reduceRegion({reducer: ee.Reducer.mean(), geometry: geom, scale: 30, maxPixels: 1e13});
  var meanPostLSTDict = postImage.select('LST').reduceRegion({reducer: ee.Reducer.mean(), geometry: geom, scale: 30, maxPixels: 1e13});
  var meanDiffDict = diff.reduceRegion({reducer: ee.Reducer.mean(), geometry: geom, scale: 30, maxPixels: 1e13});

  // Reducers for other indices for RF
  var preOpticalDict = preImage.select(['NDVI', 'FV', 'EM', 'NDBI', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B10', 'B11']).reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: geom,
    scale: 30,
    maxPixels: 1e13
  });

  var meanPreLST = ee.Algorithms.If(meanPreLSTDict.contains('LST'), meanPreLSTDict.get('LST'), null);
  var meanPostLST = ee.Algorithms.If(meanPostLSTDict.contains('LST'), meanPostLSTDict.get('LST'), null);
  var meanDiff = ee.Algorithms.If(meanDiffDict.contains('LST_Difference'), meanDiffDict.get('LST_Difference'), null);

  return feature.set({
    'mean_preLST': meanPreLST,
    'mean_postLST': meanPostLST,
    'mean_LST_diff': meanDiff
  }).set(preOpticalDict).setGeometry(feature.geometry());
}
var results = polygons.map(calculateLST);

// ------ Population Calculations ------ 

//Load extra population data and calculate vulnerable population: sum of 0-5 and 60+
var HRSL_0_5 = ee.ImageCollection("projects/sat-io/open-datasets/hrsl/hrsl_children_under_five").filterBounds(taiwan).median().rename('child_pop');
var HRSL_60plus = ee.ImageCollection("projects/sat-io/open-datasets/hrsl/hrsl_elderly_over_sixty").filterBounds(taiwan).median().rename('elderly_pop');
var HRSL_vulnerable = HRSL_0_5.add(HRSL_60plus).rename('HRSL_vulnerable');

//Calculate population in 730m buffer
function popBuffer(feature) {
  var geom = feature.geometry();
  var buffer = geom.buffer(730);
  var totalPopDict = HRSL_total.reduceRegion({reducer: ee.Reducer.sum(), geometry: buffer, scale: 30, maxPixels: 1e13});
  var vulnerablePopDict = HRSL_vulnerable.reduceRegion({reducer: ee.Reducer.sum(), geometry: buffer, scale: 30, maxPixels: 1e13});
  var childPopDict = HRSL_0_5.reduceRegion({reducer: ee.Reducer.sum(), geometry: buffer, scale: 30, maxPixels: 1e13});
  var elderlyPopDict = HRSL_60plus.reduceRegion({reducer: ee.Reducer.sum(),geometry: buffer, scale: 30, maxPixels: 1e13});
  //Round to integers
  var totalPop = ee.Number(totalPopDict.get('b1')).round();
  var vulnerablePop = ee.Number(vulnerablePopDict.get('HRSL_vulnerable')).round();
  var childPop = ee.Number(childPopDict.get('child_pop')).round();
  var elderlyPop = ee.Number(elderlyPopDict.get('elderly_pop')).round();
  //Add to feature
  return feature.set({
    'total_buffer_pop': totalPop,
    'vulnerable_buffer_pop': vulnerablePop,
    'child_buffer_pop': childPop,
    'elderly_buffer_pop': elderlyPop,
    'buffer_geometry': buffer
  });
}
var all_results = results.map(popBuffer);

// ----- Summary statistics -------

//We need to take a sample of panels for subsequent statistics and model building (otherwise nothing loads)
var sample = all_results.limit(310)

//Extract temperature differences
var lstDiffValues = sample.aggregate_array('mean_LST_diff');

var averageTempChange = lstDiffValues.reduce(ee.Reducer.mean());
var maxTempChange = lstDiffValues.reduce(ee.Reducer.max());
var minTempChange = lstDiffValues.reduce(ee.Reducer.min());

//Other brief stat: total number of polygons installed (app crashes with total area installed)
var totalPanels = all_results.size()

// ----- Random forest ------

//Filter for only valid polygons (i.e. containing both pre- and post-LST)
var validFeatures = sample.filter(ee.Filter.and(
  ee.Filter.neq('mean_LST_diff', null), 
  ee.Filter.neq('mean_preLST', null),   
  ee.Filter.neq('mean_postLST', null)    
));

//Add extra non-Landsat features: elevation, topography, and polygon area
var srtm = ee.Image('USGS/SRTMGL1_003').clip(taiwan);
var elevation = srtm.select('elevation');
var slope = ee.Terrain.slope(srtm);

var allFeatures = validFeatures.map(function(feature) {
  var geom = feature.geometry();
  var meanElevation = elevation.reduceRegion({reducer: ee.Reducer.mean(), geometry: geom, scale: 30, maxPixels: 1e13}).get('elevation');
  var meanSlope = slope.reduceRegion({reducer: ee.Reducer.mean(), geometry: geom, scale: 30, maxPixels: 1e13}).get('slope');
  var area = geom.area().divide(10000); //converting to hectares as metres were overwhelming the model
  return feature.set({
    'elevation': meanElevation,
    'slope': meanSlope,
    'area': area});
});

//Ensure all model features have elevation and slope
var test = allFeatures.filter(ee.Filter.and(
  ee.Filter.neq('elevation', null), 
  ee.Filter.neq('slope', null),
  ee.Filter.neq('area', null)
));

//Extract training data
var bands = test.select(['mean_preLST', 'mean_postLST', 'mean_LST_diff', 'NDVI', 'NDBI', 'FV', 'EM', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B10', 'B11', 'elevation', 'slope', 'area'])
  .randomColumn();

//Define test-train split
var split = 0.7;
var training_sample = bands.filter(ee.Filter.lt('random', split));
var validation_sample = bands.filter(ee.Filter.gte('random', split));

//Set up RF
var model = ee.Classifier.smileRandomForest(100)
  .setOutputMode('REGRESSION')
  .train({
    features: training_sample,
    classProperty: 'mean_postLST',
    //removed mean_preLST, EM, FV due to multicollinearity
    inputProperties: ['NDVI', 'NDBI', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B10', 'B11', 'elevation', 'slope', 'area']});

/*// ----- Assess GOF -----
//As the practicals dealt with image classification, ChatGPT was used heavily here to find appropriate metrics    
var validated = validation_sample.classify(model)

//Compare predicted vs actual 
var predictionVsActual = validated.map(function(feature) {
  return feature.set({
    'predicted': feature.get('classification'),
    'actual': feature.get('mean_postLST')
  });
});

//Calculate residuals
var residuals = predictionVsActual.map(function(f) {
  var predicted = ee.Number(f.get('predicted'));
  var actual = ee.Number(f.get('actual'));
  return f.set('residual', predicted.subtract(actual));
});

//Calculate RMSE
var mse = residuals.aggregate_array('residual').map(function(val) {
  val = ee.Number(val);
  return val.multiply(val);
}).reduce(ee.Reducer.mean());

var rmse = ee.Number(mse).sqrt();
print('Root Mean Square Error (RMSE):', rmse);

//Calculate MAE
var mae = residuals.aggregate_array('residual').map(function(val) {
  return ee.Number(val).abs();
}).reduce(ee.Reducer.mean());

print('Mean Absolute Error (MAE):', mae);

//Calculate R^2
var meanActual = predictionVsActual.aggregate_array('actual').reduce(ee.Reducer.mean());

var ssTot = predictionVsActual.aggregate_array('actual').map(function(val) {
  val = ee.Number(val);
  return val.subtract(meanActual).pow(2);
}).reduce(ee.Reducer.sum());

var ssRes = residuals.aggregate_array('residual').map(function(val) {
  val = ee.Number(val);
  return val.pow(2);
}).reduce(ee.Reducer.sum());

var r2 = ee.Number(1).subtract(ee.Number(ssRes).divide(ssTot));
print('R^2 (coefficient of determination):', r2);*/

// ----- visualize panel UI ------
/*
Root
├── Main Panel
│   ├── Title
│   ├── Button Panel
│   │   ├── Visualize Button
│   │   └── Predict Button
│   └── Content Container
│       ├── Visualize Content
│       │   ├── Statistics Cards
│       │   ├── Charts
│       │   └── Layer Controls
│       └── Predict Content
│           ├── Drawing Tools
│           └── Results Panel
└── Map
    ├── Base Layer
    ├── Solar Panels Layer
    ├── Fish Farms Layer
    └── Population Layer
*/

// Clear UI and define core functions
ui.root.clear();

// Initialize main UI components
var mainPanel = ui.Panel({
  layout: ui.Panel.Layout.flow('vertical'),
  style: {width: '500px', padding: '10px'}
});

var map = ui.Map();
map.setOptions('SATELLITE');
map.setCenter(120.10159388310306, 23.119258878572882, 13.5)

//Add a legend: ChatGPT helped with the colourbar and label spacing
var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px 15px'}});
var legendTitle = ui.Label({value: 'Temperature Difference (°C)', style: {fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0'}});
legend.add(legendTitle);
//Set visualisation parameters - same as polygons
var palette = palettes.colorbrewer.RdBu[9].reverse();
var min = -6;
var max = 6;
//Set up colour bar
var colorBar = ui.Thumbnail({image: ee.Image.pixelLonLat().select(0).multiply((max - min) / 100.0).add(min)
           .visualize({min: min, max: max, palette: palette}),
  params: {bbox: [0, 0, 100, 10], dimensions: '100x10'},
  style: {stretch: 'horizontal', margin: '0px 8px', maxHeight: '24px'}
});
legend.add(colorBar);
//Add labels
var legendLabels = ui.Panel({
  layout: ui.Panel.Layout.flow('horizontal'),
  style: {margin: '1px 0 0 0'}
});
legendLabels.add(ui.Label(min.toString(), {fontSize: '12px'}));
legendLabels.add(ui.Label(' ', {stretch: 'horizontal'})); // Spacer
legendLabels.add(ui.Label(max.toString(), {fontSize: '12px'}));
legend.add(legendLabels);
map.add(legend);

// Create UI panels and buttons
mainPanel.add(ui.Panel({
  widgets: [ui.Label('Tainan Solar Farm Heat Impact App', 
    {fontWeight: 'bold', fontSize: '22px', margin: '0 0 10px 0', padding: '6px'})],
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
    label: 'Explore Existing Solar Farms',
    onClick: function() {
      showPanel(visualizeContent, buttons.visualize, buttons.predict);
    },
    style: {padding: '4px', fontWeight: 'bold', 
            border: '1px solid #dddddd', margin: '0 2px 0 0'}
  }),
  predict: ui.Button({
    label: 'Predict Change in a New Site',
    onClick: function() {
      showPanel(predictedContent, buttons.predict, buttons.visualize);
    },
    style: {padding: '4px', fontWeight: 'bold',
            border: '1px solid #dddddd', margin: '0 2px 0 0'}
  })
};

// Button panel and container
var buttonPanel = ui.Panel([buttons.visualize, buttons.predict], 
  ui.Panel.Layout.flow('horizontal'), {margin: '0 0 20px 0'});
var contentContainer = ui.Panel();

// ----- Load Layers -----

//Set solar panel visualisation parameters
var solarStyle = {min: -6, max: 6, palette: palettes.colorbrewer.RdBu[9]}; //for some reason we don't reverse it bc we've already reversed the legend!

//Reduce to image for faster loading
var solarImage = results.reduceToImage({properties: ['mean_LST_diff'], reducer: ee.Reducer.mean()}).rename('mean_LST_diff');

//Add outlines so users can later select polygons
var outlinedPolygons = results.style({color: 'black', fillColor: '00000000', width: 0.5});
Map.addLayer(outlinedPolygons, {}, 'Polygon Outlines');

// define layerConfigs
var layerConfigs = {
  'Solar Panels': {
    layer: solarImage,
    defaultVisible: true,
    visParams: solarStyle,
    type: 'raster'
  },
  
  'Fish Farms': {
    layer: fishfarms,
    defaultVisible: false,
    visParams: {
      color: 'blue',
      fillColor: '#87CEEB88',
      width: 0
    },
    type: 'vector'
  },
  'Population Estimates': {
    layer: HRSL_total, //.select('b1'),
    defaultVisible: false,
    visParams: {
      min: 0,
      max: 16,
      palette: ['#A902A9'], //just a single colour, we don't want to complicate visualisation by having different pop colours too
      opacity: 0.5},
    type: 'raster'}
};

// define layer cache
var layerCache = {};

// define layer order for UI display
var uiLayerOrder = [
  'Solar Panels',
  'Fish Farms',
  'Population Estimates'
];

// define layer order for map display
var layerOrder = {
  'Fish Farms': 1,
  'Population Estimates': 2,
  'Solar Panels': 3
};

//Add general instructions first
visualizeContent.add(ui.Label('Welcome!', {fontWeight:'bold', fontSize:'18px'}));
visualizeContent.add(ui.Label(
  'This app uses satellite imagery to explore how solar farms influence local temperatures and communities.\n\n' +
  'Use the map and this Explore tab to get a broad understanding of solar farm impacts. Click on a solar farm on the map to get more information about it. Finally, visit the Prediction tab to assess the potential effects of building a new solar farm in a location of your choice.',
  {whiteSpace: 'pre-line'}
));

// add layer control to visualizeContent
visualizeContent.add(ui.Label('Select Data to Display:', {fontWeight: 'bold', fontSize: '16px', margin: '15px 0 5px 0'}));
uiLayerOrder.forEach(function(layerName) {
  visualizeContent.add(createLayerControl(layerName));
});

// add Summary Statistics panel
visualizeContent.add(ui.Label('Overview:', {fontWeight: 'bold', fontSize: '16px', margin: '15px 0 5px 0'}));

//Add total polygon numbers
var totalPanelsLabel = ui.Label('Loading total polygons count...', {
  fontSize: '14px',
  color: 'gray'});
visualizeContent.add(totalPanelsLabel);

totalPanels.evaluate(function(count) { //replace when calculated
  visualizeContent.remove(totalPanelsLabel);
  var boldLabel = ui.Label(String(count), {
    fontSize: '15px', fontWeight: 'bold', color: 'black', padding: '0', margin: '0 4px 0 0'});
  var regularLabel = ui.Label(' solar farms installed since March 2019.', {
    fontSize: '15px', color: 'black', padding: '0', margin: '0'});
  //Use a panel to make sure they're added next to each other
  var labelPanel = ui.Panel({
    widgets: [boldLabel, regularLabel],
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {padding: '0', margin: '4px'}});
  visualizeContent.widgets().insert(7, labelPanel); //make sure it's added in same position as before - ChatGPT helped
});

//Add summary statistics
var statCardsPanel = ui.Panel({
  layout: ui.Panel.Layout.flow('horizontal'),
  style: {stretch: 'horizontal', margin: '10px 0'}
});

//Add a loading screen before the stats are calculated
var loadingCard = ui.Label('Loading maximum, minimum, and average temperature change...', {
  fontSize: '14px',
  color: 'gray',
});
statCardsPanel.add(loadingCard);

function createStatCard(label, value, color,textColor) {
  return ui.Panel([
    ui.Label(label, {
      fontWeight: 'bold',
      fontSize: '14px',
      color: textColor,
      backgroundColor: color
    }),
    ui.Label(value, {
      fontSize: '18px',
      color: textColor,
      backgroundColor: color
    })
  ], ui.Panel.Layout.flow('vertical'), {
    padding: '10px',
    backgroundColor: color,
    borderRadius: '8px',
    margin: '4px',
    width: '30%'
  });
}

//Add Stat Cards in the order: min, max, average
minTempChange.evaluate(function(min) {
  statCardsPanel.clear(); //remove the loading bit
  statCardsPanel.add(createStatCard('Min Temp Change', min.toFixed(2) + ' °C', '#2166ac','white'));
  
  averageTempChange.evaluate(function(avg) {
    statCardsPanel.add(createStatCard('Avg Temp Change', avg.toFixed(2) + ' °C', '#f7f7f7','black'));

    maxTempChange.evaluate(function(max) {
      statCardsPanel.add(createStatCard('Max Temp Change', max.toFixed(2) + ' °C', '#b2182b','white'));
    });
  });
});
visualizeContent.add(statCardsPanel);

// add chart label and container
visualizeContent.add(ui.Label('Deeper Trends:', {fontWeight: 'bold', fontSize: '16px', margin: '15px 0 5px 0'}));

// Create charts directly
var tempDistChart = ui.Chart.feature.histogram({
  features: sample,
  property: 'mean_LST_diff',
  minBucketWidth: 0.1
}).setOptions({
  title: 'What is the distribution of temperature change?',
  hAxis: {title: 'Temperature Change (°C)'},
  vAxis: {title: 'Number of Solar Farms'},
  legend: {position: 'none'},
  colors: ['#FE8789']
});

var popDistChart = ui.Chart.feature.histogram({
  features: sample,
  property: 'total_buffer_pop',
  minBucketWidth: 50
}).setOptions({
  title: 'How many people typically live near a solar farm?',
  hAxis: {title: 'Total Population Within 730m'},
  vAxis: {title: 'Number of Solar Farms'},
  legend: {position: 'none'},
  colors: ['#A902A9']
});

var nicerName = allFeatures.map(function(feature) { //improve appearance
  return feature.set('Temperature Change (°C)', feature.get('mean_LST_diff'));
});

var tempVsAreaChart = ui.Chart.feature.byFeature(
  nicerName.filter(ee.Filter.notNull(['area', 'Temperature Change (°C)'])),
  'area',
  'Temperature Change (°C)'
).setChartType('ScatterChart')
 .setOptions({
   title: 'Is there a relationship between solar farm area and temperature?',
   hAxis: {
     title: 'Logged Area (hectares)',
     scaleType: 'log',
     format: 'short'
   },
   vAxis: {
     title: 'Temperature Change (°C)',
     viewWindow: {
       min: -1,
       max: 5
     }
   },
   pointSize: 1,
   colors: ['#ff8800'],
   legend: {position: 'none'},
   chartArea: {width: '85%', height: '80%'},
   series: {0: {labelInLegend: 'Temp Change (°C)'}}
 });

// Create a container for all charts
var chartsContainer = ui.Panel({
  style: {margin: '10px 0'}
});

// Add charts to the container
visualizeContent.add(tempDistChart);
visualizeContent.add(popDistChart);
visualizeContent.add(tempVsAreaChart);


//add disclaimer
visualizeContent.add(ui.Label(
  'Please note that charts and summary statistics are based on a random sample of all solar farms. Although they closely reflect overall trends, exact values may vary slightly.',
  {fontSize: '13px', fontStyle: 'italic'}));

// then define createLayerControl function
function createLayerControl(layerName) {
  var config = layerConfigs[layerName];
  
  function createLayer() {
    if (config.type === 'vector') {
      return ui.Map.Layer({
        eeObject: config.layer.style(config.visParams),
        name: layerName,
        shown: config.defaultVisible
      });
    }
    return ui.Map.Layer({
      eeObject: config.layer,
      visParams: config.visParams,
      name: layerName,
      shown: config.defaultVisible
    });
  }

  var checkbox = ui.Checkbox({
    label: layerName,
    value: config.defaultVisible,
    onChange: function(checked) {
      if (!layerCache[layerName]) {
        layerCache[layerName] = createLayer();
      }
      
      layerCache[layerName].setShown(checked);

      // Add logic to link solar panel outlines (i.e. features) to the coloured panels (images) - ChatGPT helped here
      if (layerName === 'Solar Panels') {
        if (checked) {
          layerCache['Polygon Outlines'] = ui.Map.Layer(outlinedPolygons, {}, 'Polygon Outlines');
        } else {
          layerCache['Polygon Outlines'] = null;
        }
      }

      var visibleLayers = [];
      // Sort layers by layerOrder
      var sortedLayers = Object.keys(layerConfigs).sort(function(a, b) {
        return layerOrder[a] - layerOrder[b];
      });
      
      sortedLayers.forEach(function(name) {
        if (layerCache[name] && layerCache[name].getShown()) {
          visibleLayers.push(layerCache[name]);
        }

        //Again, ensure solar panel outlines are being shown if solar panels are
        if (name === 'Solar Panels' && layerCache['Polygon Outlines']) {
          visibleLayers.push(layerCache['Polygon Outlines']);
        }
      });

      map.layers().reset(visibleLayers);
    }
  });

  //Default load solar panel outlines, even though we don't want this to be shown in the UI
  if (config.defaultVisible) {
    layerCache[layerName] = createLayer();
    map.add(layerCache[layerName]);

    if (layerName === 'Solar Panels') {
      layerCache['Polygon Outlines'] = ui.Map.Layer(outlinedPolygons, {}, 'Polygon Outlines');
      map.add(layerCache['Polygon Outlines']);
    }
  }

  return ui.Panel([checkbox], ui.Panel.Layout.flow('horizontal'));
}

// craete cache function
var chartCache = {
  visualizeContent: null,
  charts: []
};

// showPanel function
function showPanel(panel, activeButton, inactiveButton) {
  // hide all panels
  visualizeContent.style().set('shown', false);
  predictedContent.style().set('shown', false);
  
  // show the selected panel
  if (panel === visualizeContent) {
    visualizeContent.style().set('shown', true);
    contentContainer.add(visualizeContent);
  } else {
    predictedContent.style().set('shown', true);
    contentContainer.add(predictedContent);
  }
  
  activeButton.style().set({fontWeight: 'bold'});
  inactiveButton.style().set({fontWeight: 'bold'});
}

// Assemble UI and initialize
mainPanel.add(buttonPanel);
mainPanel.add(contentContainer);

// Feature to click on solar farm polygons for more info:
var panel = null;
var highlightLayer = null;

// Add map click handler
map.onClick(function(coords) {
  var point = ee.Geometry.Point(coords.lon, coords.lat);
  
  // remove existing panel/highlight
  if (panel !== null) {
    map.remove(panel);
    panel = null;
  }
  
  if (highlightLayer !== null) {
    map.remove(highlightLayer);
    highlightLayer = null;
  }
  
  // create panel
  panel = ui.Panel({
    style: {
      position: 'top-right',
      padding: '8px',
      width: '320px',
      backgroundColor: 'rgba(25, 25, 25, 0.8)'
    }
  });
  
  //define button to close the pop-up
  var closeButton = ui.Button({
    label: 'Close Panel',
    style: {margin: '4px', backgroundColor: '00000000'}, //color: 'white'},
    onClick: function() {
      map.remove(panel);
      panel = null;
      if (highlightLayer !== null) {
        map.remove(highlightLayer);
        highlightLayer = null;
      }
    }
  });

  // show initial loading panel so the user knows something's happening
  panel.add(ui.Label('Solar Farm Summary:', {fontSize: '16px', fontWeight: 'bold', color: 'white', backgroundColor: '00000000'}))
       .add(ui.Label('Calculating...', {color: 'white', backgroundColor: '00000000'}));

  map.add(panel);
  
  // extract properties from all_results
  var featureWithArea = all_results
  .filterBounds(point)
  .map(function(f) {
    return f.set('area_hectare', f.geometry().area().divide(1e6));
  })
  .first();

  featureWithArea.evaluate(function(feature) { 
    //in case the user didn't select a panel
    if (!feature) {
      panel.clear();
      panel.add(ui.Label('There are no solar farms at this location. Please select a new site.', 
      {fontSize: '16px', color: 'white', backgroundColor: '00000000'}))
      .add(closeButton);
      return;
    }

    // draw outline of selected feature
    var geom = ee.Feature(feature).geometry();
    highlightLayer = ui.Map.Layer(geom, {color: 'yellow', fillColor: '00000000', width: 3}, 'Selected Area');
    map.add(highlightLayer);
    
    //extract properties from all_results
    var props = feature.properties;
  
    // Update panel with actual info
    panel.clear();
    panel.add(ui.Label('Solar Farm Summary:', {fontSize: '16px', fontWeight: 'bold', color: 'white', backgroundColor: '00000000'}))
         .add(ui.Label('Installation date: ' + props.dateright, {color: 'white', backgroundColor: '00000000'}))
         .add(ui.Label('Average temperature change: ' + props.mean_LST_diff.toFixed(2) + '°C', {color: 'white', backgroundColor: '00000000'}))
         .add(ui.Label('Area: ' + props.area_hectare.toFixed(2) + ' hectares', {color: 'white', backgroundColor: '00000000'}))
         .add(ui.Label('Potential population affected: ' + props.total_buffer_pop, {color: 'white', backgroundColor: '00000000'}))
         .add(closeButton);
  });
});

// ----------- Prediction panel ----------

// Initialize default view
showPanel(visualizeContent, buttons.visualize, buttons.predict);

// Add to UI root
ui.root.add(ui.Panel([mainPanel, map], ui.Panel.Layout.flow('horizontal'), 
  {width: '100%', height: '100%'}));

// clear the predictedContent
predictedContent.clear();

// add a description label
predictedContent.add(ui.Label('To explore the effects of building a solar farm in a new site, please click the button below and draw a polygon on the map. Please make sure you draw the panel over a fish farm.', 
  {fontSize: '14px', margin: '0 0 10px 0'}));

//Add button to draw the polygons
var drawButton = ui.Button({
  label: 'Draw a new solar farm',
  onClick: function() {
    // clear the previous drawing
    map.drawingTools().layers().reset();
    map.drawingTools().setShape('polygon');
    map.drawingTools().draw();
    
    // Disable the draw button and prevent further drawing
    drawButton.setDisabled(true);
    
    // Start drawing and disable the drawing tools until drawing is complete
    map.drawingTools().setShown(false);
  },
  style: {margin: '0 0 10px 0'}
});
predictedContent.add(drawButton);

// add a results panel
var resultsPanel = ui.Panel({
  style: {
    margin: '10px 0',
    padding: '5px',
    border: '1px solid #ddd',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    shown: false
  }
});
predictedContent.add(resultsPanel);

// add a loading label to the predictedContent
var loadingLabel = ui.Label('Please wait while the model runs...', {
  fontStyle: 'italic',
  fontSize: '15px',
  //color: '#1a73e8',
  margin: '10px 0',
  shown: false
});
predictedContent.add(loadingLabel);

// Create a small text label to appear under the results panel
var modelInfo = ui.Label('Please be aware that although the model is a useful tool, its predictions are unlikely to be perfectly accurate. The model explains 79% of variation in temperature change, with an average error of approximately 0.33°C.', {
  //fontSize: '13px',
  //fontStyle: 'italic',
  //color:'#8B0002',
  shown:false
});
predictedContent.add(modelInfo);

// Modify the map drawing completion event processing
map.drawingTools().onDraw(function(geometry) {
  resultsPanel.clear();
  loadingLabel.style().set('shown', true);  // show the loading label
  modelInfo.style().set('shown', false); //ensure model explanation and results panel are hidden, even if they were shown before
  resultsPanel.style().set('shown', false);
  
  //Only run if there is some intersection with fishfarms
  var intersection = fishfarms.filterBounds(geometry).size().gt(0);
  
  intersection.evaluate(function(intersects) {
    if (intersects) {

    //Slightly changed version of the original analysis - does all calculations simultaneously to reduce waiting time
      var computeScale = 30;
      var feature = ee.Feature(geometry);
      var pop = popBuffer(feature); //run pop function from above
      var now = ee.Date(Date.now());
      var polygonStart = now.advance(-3, 'year');
      var polygonEnd = now;
      var currentImage = ee.Image(getLST(geometry, polygonStart, polygonEnd)); //run LST calculation from above
      var allComputations = ee.Dictionary({});

      // perform the calculations separately and merge the results
      var lstDict = currentImage.select('LST').reduceRegion({reducer: ee.Reducer.mean(), geometry: geometry, scale: computeScale, maxPixels: 1e13});
      var indicesDict = currentImage.select(['NDVI', 'NDBI', 'FV', 'EM', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B10', 'B11']).reduceRegion({
        reducer: ee.Reducer.mean(), geometry: geometry, scale: computeScale, maxPixels: 1e13});
      var elevationDict = elevation.reduceRegion({reducer: ee.Reducer.mean(),geometry: geometry,scale: computeScale, maxPixels: 1e13});
      var slopeDict = slope.reduceRegion({reducer: ee.Reducer.mean(), geometry: geometry, scale: computeScale, maxPixels: 1e13});

      // Combine all the results
      var combinedResults = ee.Dictionary(lstDict)
        .combine(indicesDict)
        .combine(elevationDict)
        .combine(slopeDict)
        .combine(pop.toDictionary(['total_buffer_pop', 'vulnerable_buffer_pop', 'child_buffer_pop', 'elderly_buffer_pop']));

      combinedResults.evaluate(function(results) {
        if (results.LST !== null) {
          var currentLST = results.LST;
          
          //Create finished feature
          var predictionFeature = ee.Feature(geometry, {
            'NDVI': results.NDVI,
            'NDBI': results.NDBI,
            'B1': results.B1,
            'B2': results.B2,
            'B3': results.B3,
            'B4': results.B4,
            'B5': results.B5,
            'B6': results.B6,
            'B7': results.B7,
            'B10': results.B10,
            'B11': results.B11,
            'elevation': results.elevation,
            'slope': results.slope,
            'area': geometry.area().divide(10000)});
          
          //Predict using model
          var predicted = ee.FeatureCollection([predictionFeature]).classify(model);
          predicted.first().get('classification').evaluate(function(futureTemp) {
            var tempDiff = futureTemp - currentLST;
            
            //Hide loading label
            loadingLabel.style().set('shown', false);
            
            //Print results
            resultsPanel.style().set('shown', true);
            resultsPanel.widgets().reset([ 
              ui.Label('Site Summary：', {fontWeight: 'bold', margin: '0 0 8px 0'}),
              ui.Label('Current temperature：' + currentLST.toFixed(2) + '°C'),
              ui.Label('Predicted temperature with solar farm：' + futureTemp.toFixed(2) + '°C'),
              ui.Label('Predicted temperature change：' + tempDiff.toFixed(2) + '°C'),
              ui.Label('Potential population affected：' + (results.total_buffer_pop || 0) + ' people'),
              ui.Label('Potential vulnerable population affected：' + (results.vulnerable_buffer_pop || 0) + ' people'),
              ui.Label('Populations are calculated within 730m of the polygon. Vulnerable population refers to estimated numbers of children (0-5) and elderly (60+) individuals living within this area.', {
                  fontSize: '12px', fontStyle: 'italic'})
            ]);
            modelInfo.style().set('shown', true); 
            drawButton.setDisabled(false);
            
          });
        } else {
          loadingLabel.style().set('shown', false);
          resultsPanel.style().set('shown', true);
          resultsPanel.add(ui.Label('There is insufficient satellite imagery to calculate temperature for this location. Please select a different area.'));
          drawButton.setDisabled(false);
        }
      });
    } else {
      loadingLabel.style().set('shown', false);
      resultsPanel.style().set('shown', true);
      resultsPanel.add(ui.Label('This polygon does not intersect with any fish farms. Please redraw in a different location.'));
      drawButton.setDisabled(false);
    }

    //Stop and hide drawing tools once processing is finished
    map.drawingTools().stop();
    map.drawingTools().setShown(false);

    //Re-enable the drawing button
    //drawButton.setDisabled(false);
  });
});