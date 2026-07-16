Pod::Spec.new do |s|
  s.name           = 'ExpoDurableFile'
  s.version        = '1.0.0'
  s.summary        = 'Narrow durable-file publication primitive for InspectionHub Field'
  s.description    = 'Copies, synchronises, hashes and exclusively publishes one capture inside the app container.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
