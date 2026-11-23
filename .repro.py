import folium, geopandas as gpd, numpy as np
from shapely.geometry import Point
from foliplus import LayerControl

np.random.seed(7)
pts = [Point(118.0+np.random.rand()*0.2, 24.4+np.random.rand()*0.2) for _ in range(40)]
gdf = gpd.GeoDataFrame({'score': np.random.randint(1,100,40), 'geometry': pts}, crs='EPSG:4326')
m = folium.Map(location=[24.5,118.1], zoom_start=11, tiles='OpenStreetMap')
gdf.explore(m=m, name='Facility Points', column='score', cmap='plasma',
            marker_type='circle_marker',
            style_kwds={'radius': 5, 'fillOpacity': 0.8, 'stroke': False},
            legend=False, show=True)
LayerControl(locale='zh').add_to(m)
m.save('.foliplus/demo/quickstart-repro.html')
print('saved')