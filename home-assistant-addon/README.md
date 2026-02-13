This folder contains files to allow running wuFlow as a Home Assistant Add-on.
Even if it sounds strange, it is a good way to run it on a Raspberry Pi as a local server in your home.
Then you and your family can acces it using a browser and the internal Homeassistant URL.

Install it either by using the Home Assistant Add-on store or by manually copying the files to the addons folder.

Configuration options are not supported yet. You can configure wuFlow by editing the configuration file directly and adapting the environment section in the config.yaml file.

To set the initial admin password once for the first start, set the envvar WF_INITIAL_ADMIN_PASSWORD in the config.yaml file. After the first start, the password will be stored in the database and the envvar will be ignored. So afterwards, you should remove it from the config.yaml file again.