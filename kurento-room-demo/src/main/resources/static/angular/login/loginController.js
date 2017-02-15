/*
 * @author Micael Gallego (micael.gallego@gmail.com)
 * @author Radu Tom Vlad
 */

kurento_room.controller('loginController', function($scope, $rootScope, $http, 
    $window, $routeParams, ServiceParticipant, ServiceRoom, LxNotificationService) {

    ServiceParticipant.clean();
    $scope.existingRoomName = false;
    $scope.roomPickerClass = 'grid__col6';
    $scope.roomPickerLabel = 'Room';
    var name = $routeParams["existingRoomName"];
    if (name && name.length > 0) {
        var str = name.split("@");
        if(str.length == 2) {
            $scope.room = {
                userName: str[0],
                roomName: str[1]
            };
        } else {
            $scope.room = {roomName: name};
        }
        $scope.existingRoomName = true;
        $scope.roomPickerClass = 'grid__col';
        $scope.roomPickerLabel = 'Fixed room name';
    }

    $scope.nameValidation = function(name) {
        return /^[a-zA-Z0-9]+$/.test(name);
    };

    $rootScope.isParticipant = false;
    
    var contextpath = (location.pathname == '/') ? '' : location.pathname;

    $rootScope.contextpath = (location.pathname == '/') ? '' : location.pathname;

    var roomsFragment = $rootScope.contextpath.endsWith('/') ? '#/rooms/' : '/#/rooms/';

    $http.get($rootScope.contextpath + '/getAllRooms').success(function(data, status, headers, config) {
        console.log(JSON.stringify(data));
        $scope.listRooms = data;
    }).error(function(data, status, headers, config) {});

    $http.get($rootScope.contextpath + '/getClientConfig').success(function(data, status, headers, config) {
        console.log(JSON.stringify(data));
        $scope.clientConfig = data;
    }).error(function(data, status, headers, config) {});

    $http.get($rootScope.contextpath + '/getUpdateSpeakerInterval').success(function(data, status, headers, config) {
        $scope.updateSpeakerInterval = data
    }).error(function(data, status, headers, config) {});

    $http.get($rootScope.contextpath + '/getThresholdSpeaker').success(function(data, status, headers, config) {
        $scope.thresholdSpeaker = data
    }).error(function(data, status, headers, config) {});

    
    $scope.register = function (room) {
    	
    	if (!room)
    		ServiceParticipant.showError($window, LxNotificationService, {
    			error: {
    				message:"Username and room fields are both required"
    			}
    		});

        var config = {loopback: false,
                      loopbackAndLocal: false};
        if(!$scope.clientConfig) {
            $scope.clientConfig = config;
            $scope.updateSpeakerInterval = 1000;
            $scope.thresholdSpeaker = 10;
        }
    	
        $scope.userName = room.userName;
        $scope.roomName = room.roomName;

        var wsUri = 'wss://' + location.host + '/room';

        //show loopback stream from server
        var displayPublished = $scope.clientConfig.loopbackRemote || false;
        //also show local stream when display my remote
        var mirrorLocal = $scope.clientConfig.loopbackAndLocal || false;
        
        var kurento = KurentoRoom(wsUri, function (error, kurento) {

            if (error)
                return console.log(error);

            //TODO token should be generated by the server or a 3rd-party component  
            //kurento.setRpcParams({token : "securityToken"});

            room = kurento.Room({
                room: $scope.roomName,
                user: $scope.userName,
                updateSpeakerInterval: $scope.updateSpeakerInterval,
                thresholdSpeaker: $scope.thresholdSpeaker 
            });

            ServiceRoom.setRoom(room);

            var localStream = kurento.Stream(room, {
                id: "webcam",
                audio: true,
                video: true,
                data: false
            });

            localStream.addEventListener("access-accepted", function () {
                room.addEventListener("room-connected", function (roomEvent) {
                	//var streams = roomEvent.streams;
                    var participants = roomEvent.participants;
                	if (displayPublished ) {
                		localStream.subscribeToMyRemote();
                	}
                	localStream.publish();
                    ServiceRoom.setLocalStream(localStream.getWebRtcPeer());
                    console.debug("addLocalParticipant");
                    ServiceParticipant.addLocalParticipant(room.getLocalParticipant(), localStream);
                    // for (var i = 0; i < streams.length; i++) {
                    //     ServiceParticipant.addParticipant(streams[i]);
                    // }
                    for (var i=0; i < participants.length; i++) {
                        ServiceParticipant.addParticipant(participants[i]);
                    }
                });

                room.addEventListener("stream-published", function (streamEvent) {
                	//  ServiceParticipant.addLocalParticipant(localStream);
                	 if (mirrorLocal && localStream.displayMyRemote()) {
                		 var localVideo = kurento.Stream(room, {
                             video: true,
                             id: "localStream"
                         });
                		 localVideo.mirrorLocalStream(localStream.getWrStream());
                		 ServiceParticipant.addLocalMirror(localVideo);
                	 } else if (streamEvent.stream !== localStream) {
                         ServiceParticipant.addStream(streamEvent.participant, streamEvent.stream);
                     }
                });
                
                room.addEventListener("stream-added", function (streamEvent) {
                    console.debug("handle event stream-added");
                    ServiceParticipant.addStream(streamEvent.participant, streamEvent.stream);
                    //ServiceParticipant.addParticipant(streamEvent.stream);
                });

                room.addEventListener("stream-removed", function (streamEvent) {
                    ServiceParticipant.removeStream(streamEvent.participantId, streamEvent.stream.getID());
                    //ServiceParticipant.removeParticipantByStream(streamEvent.stream);
                });

                room.addEventListener("newMessage", function (msg) {
                    ServiceParticipant.showMessage(msg.room, msg.user, msg.message);
                });

                room.addEventListener("error-room", function (error) {
                    ServiceParticipant.showError($window, LxNotificationService, error);
                });

                room.addEventListener("error-media", function (msg) {
                    ServiceParticipant.alertMediaError($window, LxNotificationService, msg.error, function (answer) {
                    	console.warn("Leave room because of error: " + answer);
                    	if (answer) {
                    		kurento.close(true);
                    	}
                    });
                });
                
                room.addEventListener("room-closed", function (msg) {
                	if (msg.room !== $scope.roomName) {
                		console.error("Closed room name doesn't match this room's name", 
                				msg.room, $scope.roomName);
                	} else {
                		kurento.close(true);
                		ServiceParticipant.forceClose($window, LxNotificationService, 'Room '
                			+ msg.room + ' has been forcibly closed from server');
                	}
                });
                
                room.addEventListener("lost-connection", function(msg) {
                    kurento.close(true);
                    ServiceParticipant.forceClose($window, LxNotificationService,
                      'Lost connection with room "' + msg.room +
                      '". Please try reloading the webpage...');
                  });
                
                room.addEventListener("stream-stopped-speaking", function (participantId) {
                    ServiceParticipant.streamStoppedSpeaking(participantId);
                 });

                 room.addEventListener("stream-speaking", function (participantId) {
                    ServiceParticipant.streamSpeaking(participantId);
                 });

                 room.addEventListener("update-main-speaker", function (participantId) {
                     ServiceParticipant.updateMainSpeaker(participantId);
                  });

                room.connect();
            });

            localStream.addEventListener("access-denied", function () {
            	ServiceParticipant.showError($window, LxNotificationService, {
            		error : {
            			message : "Access not granted to camera and microphone"
            				}
            	});
            });
            localStream.init();
        });

        //save kurento & roomName & userName in service
        ServiceRoom.setKurento(kurento);
        ServiceRoom.setRoomName($scope.roomName);
        ServiceRoom.setUserName($scope.userName);

        $rootScope.isParticipant = true;

        //redirect to call
        $window.location.href = '#/call';
    };
    $scope.clear = function () {
        $scope.room = "";
        $scope.updateRoomUrl();
    };
    $scope.updateRoomUrl = function(roomName) {
        $scope.roomUrl = (roomName && roomName.length > 0) ? location.protocol + '//' + location.host + $rootScope.contextpath + roomsFragment + roomName : '';
    };

    if($scope.existingRoomName && $scope.room && $scope.room.userName && $scope.room.roomName) {
        $scope.register($scope.room);
    }
});


